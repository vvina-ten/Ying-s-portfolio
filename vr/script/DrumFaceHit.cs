using UnityEngine;
using System.Collections.Generic;

/// <summary>
/// 鼓面碰撞检测器
///
/// 逻辑：鼓棒尖端 Trigger 进入此区域
///       → 询问 HeavyHitZone：最近 heavyTimeWindow 秒内是否经过？
///       → 是 = PlayHeavy()，否 = PlayLight()
///
/// ★ 速度感应兼容 Kinematic Rigidbody：
///   通过追踪碰撞体前几帧的位置变化来估算速度，
///   解决 Kinematic 物体 linearVelocity 永远为零的问题。
///
/// 挂载位置：鼓面正面的薄层 Trigger GameObject
/// 需要组件：Collider（IsTrigger = true）
/// </summary>
public class DrumFaceHit : MonoBehaviour
{
    [Header("── 引用 ──")]
    [Tooltip("HeavyHitZone 脚本所在物体")]
    public HeavyHitZone heavyZone;

    [Tooltip("DrumAudioManager 脚本；留空则自动查找单例")]
    public DrumAudioManager audioManager;

    [Header("── 识别标签 ──")]
    [Tooltip("鼓棒尖端 GameObject 的 Tag")]
    public string drumstickTag = "Drumstick";

    [Header("── 重击时间窗口 ──")]
    [Tooltip("敲击鼓面前多少秒内经过 HeavyHitZone 才算重击")]
    public float heavyTimeWindow = 2f;

    [Header("── 冷却（防同帧重复触发） ──")]
    [Range(0.05f, 0.5f)]
    public float cooldown = 0.15f;

    [Header("── 速度估算（兼容 Kinematic）──")]
    [Tooltip("追踪最近多少帧来估算速度（帧数越多越平滑，但响应略慢）")]
    [Range(2, 10)]
    public int velocityTrackFrames = 4;

    [Header("── 启动保护 ──")]
    [Tooltip("游戏开始后多少秒内忽略碰撞（防止 Animator 刚启动时误触发）")]
    public float startupIgnoreTime = 0.5f;

    // ── 内部 ──
    float _lastHitTime = -9999f;

    // 位置历史：Key = Collider InstanceID，Value = 环形缓冲区（位置+时间）
    readonly Dictionary<int, (Vector3 pos, float time)[]> _posHistory
        = new Dictionary<int, (Vector3, float)[]>();
    readonly Dictionary<int, int> _posHead
        = new Dictionary<int, int>();   // 环形写指针

    // ===== 生命周期 =====

    void Start()
    {
        if (audioManager == null)
            audioManager = DrumAudioManager.Instance;

        if (audioManager == null)
            Debug.LogWarning("[DrumFaceHit] 找不到 DrumAudioManager，请检查场景！");

        // ★ 启动保护：游戏开始头 startupIgnoreTime 秒内的碰撞全部忽略
        _lastHitTime = Time.time + startupIgnoreTime;
    }

    // ===== Trigger 事件 =====

    void OnTriggerEnter(Collider other)
    {
        if (!other.CompareTag(drumstickTag)) return;

        // 记录入场位置
        RecordPos(other);

        if (Time.time - _lastHitTime < cooldown) return;
        _lastHitTime = Time.time;

        bool isHeavy = heavyZone != null && heavyZone.WasTouchedWithin(heavyTimeWindow);

        float speed = EstimateSpeed(other);
        audioManager?.PlayByVelocity(speed, isHeavy);
    }

    void OnTriggerStay(Collider other)
    {
        // 持续记录位置，供碰撞瞬间计算速度
        if (other.CompareTag(drumstickTag))
            RecordPos(other);
    }

    void OnTriggerExit(Collider other)
    {
        if (other.CompareTag(drumstickTag))
        {
            _posHistory.Remove(other.GetInstanceID());
            _posHead.Remove(other.GetInstanceID());
        }
    }

    // ===== 位置追踪 =====

    void RecordPos(Collider col)
    {
        int id = col.GetInstanceID();

        if (!_posHistory.TryGetValue(id, out var buf))
        {
            buf = new (Vector3, float)[velocityTrackFrames];
            _posHistory[id] = buf;
            _posHead[id]    = 0;
        }

        int head = _posHead[id];
        buf[head] = (col.transform.position, Time.time);
        _posHead[id] = (head + 1) % velocityTrackFrames;
    }

    // ===== 速度估算 =====

    float EstimateSpeed(Collider col)
    {
        // 1. 非 Kinematic → 直接用物理速度（最准确）
        Rigidbody rb = col.attachedRigidbody;
        if (rb != null && !rb.isKinematic)
            return rb.linearVelocity.magnitude;

        // 2. Kinematic / 无 Rigidbody → 用位置历史估算
        int id = col.GetInstanceID();
        if (!_posHistory.TryGetValue(id, out var buf) || buf == null)
            return 0f;

        // 找最老和最新的有效采样点
        Vector3 oldest = Vector3.zero;
        float   oldestT = float.MaxValue;
        Vector3 newest  = Vector3.zero;
        float   newestT = float.MinValue;
        bool    hasData  = false;

        foreach (var sample in buf)
        {
            if (sample.time <= 0f) continue;  // 未初始化的槽
            if (sample.time < oldestT) { oldest = sample.pos; oldestT = sample.time; }
            if (sample.time > newestT) { newest = sample.pos; newestT = sample.time; }
            hasData = true;
        }

        if (!hasData) return 0f;

        float dt = newestT - oldestT;
        return dt > 0.0001f ? Vector3.Distance(newest, oldest) / dt : 0f;
    }
}
