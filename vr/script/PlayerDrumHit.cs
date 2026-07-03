using UnityEngine;
using System.Collections.Generic;

/// <summary>
/// 玩家鼓面交互 —— 自包含版（不依赖 DrumAudioManager 单例）
///
/// 挂载位置：playerDRUM 下面的 playeinteraction（Trigger Collider 所在物体）
///
/// 功能：
///   - 鼓棒碰到 → 按速度 + HeavyZone 判断轻/重击，直接用自己的 AudioSource 发声
///   - 兼容 Kinematic Rigidbody（用位置差估算速度，而非 linearVelocity）
///   - 启动保护：Play 后头几秒忽略碰撞，防止初始位置重叠误触发
/// </summary>
public class PlayerDrumHit : MonoBehaviour
{
    // ─────────────────────────────────────────
    [Header("── 音频 ──")]
    [Tooltip("拖入 playerDRUM 上的 AudioSource")]
    public AudioSource audioSource;

    [Tooltip("轻击音效；留空则复用 audioSource.clip")]
    public AudioClip lightClip;

    [Tooltip("重击音效；留空则复用 audioSource.clip")]
    public AudioClip heavyClip;

    // ─────────────────────────────────────────
    [Header("── 整体音量 ──")]
    [Range(0f, 1f)]
    [Tooltip("总响度；轻/重击是在这个基础上的相对比例")]
    public float masterVolume = 1f;

    // ─────────────────────────────────────────
    [Header("── 轻 / 重击参数 ──")]
    [Range(0f, 1f)]
    [Tooltip("轻击相对于重击的音量比例（例：0.65 = 重击的 65%）")]
    public float lightVolumeScale = 0.65f;

    [Range(0.5f, 2f)]
    [Tooltip("轻击音调（略高一点听起来更轻盈）")]
    public float lightPitch = 1.08f;

    [Range(0.5f, 2f)]
    [Tooltip("重击音调（正常 = 1.0）")]
    public float heavyPitch = 1.0f;

    // ─────────────────────────────────────────
    [Header("── 速度感应 ──")]
    [Tooltip("鼓棒达到此速度（m/s）时为满音量；调小 = 更容易触发满音量")]
    public float maxHitVelocity = 3f;

    [Range(0.3f, 1f)]
    [Tooltip("最轻一击的音量下限（相对于轻/重击音量）——不要设太低！建议 0.5~0.7）")]
    public float minSpeedScale = 0.55f;

    // ─────────────────────────────────────────
    [Header("── 重击判断 ──")]
    [Tooltip("拖入 playerheavyzone 上的 HeavyHitZone 脚本")]
    public HeavyHitZone heavyZone;

    [Tooltip("敲击鼓面前多少秒内经过 heavyZone 才算重击")]
    public float heavyTimeWindow = 1.5f;

    // ─────────────────────────────────────────
    [Header("── 识别标签 ──")]
    [Tooltip("鼓棒尖端的 Tag（playerDRumstick 上设置的）")]
    public string drumstickTag = "Drumstick";

    // ─────────────────────────────────────────
    [Header("── 冷却 & 启动保护 ──")]
    [Range(0.05f, 0.5f)]
    [Tooltip("两次触发之间的最短间隔（秒）")]
    public float cooldown = 0.12f;

    [Tooltip("Play 后多少秒内忽略所有碰撞")]
    public float startupIgnoreTime = 0.8f;

    [Header("── 调试 ──")]
    public bool showDebugLog = false;

    // ─────────────────────────────────────────
    // 内部
    float _lastHitTime = -9999f;

    // Kinematic 速度估算：位置历史缓冲
    readonly Dictionary<int, (Vector3 pos, float time)[]> _posHistory
        = new Dictionary<int, (Vector3, float)[]>();
    readonly Dictionary<int, int> _posHead = new Dictionary<int, int>();
    const int TRACK_FRAMES = 5;

    // ─────────────────────────────────────────
    void Start()
    {
        // 自动在父层找 AudioSource（如果没手动拖）
        if (audioSource == null)
            audioSource = GetComponentInParent<AudioSource>();

        if (audioSource == null)
            Debug.LogWarning("[PlayerDrumHit] 找不到 AudioSource！请手动拖入。");

        // 启动保护
        _lastHitTime = Time.time + startupIgnoreTime;
    }

    // ─────────────────────────────────────────
    void OnTriggerEnter(Collider other)
    {
        if (!other.CompareTag(drumstickTag)) return;

        RecordPos(other);   // 记录入场位置

        if (Time.time - _lastHitTime < cooldown) return;
        _lastHitTime = Time.time;

        bool  isHeavy = heavyZone != null && heavyZone.WasTouchedWithin(heavyTimeWindow);
        float speed   = EstimateSpeed(other);

        PlayHit(speed, isHeavy);
    }

    void OnTriggerStay(Collider other)
    {
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

    // ─────────────────────────────────────────
    void PlayHit(float speed, bool isHeavy)
    {
        if (audioSource == null) return;

        // 速度比例：[minSpeedScale, 1.0] —— 即使轻轻一敲也有基本响度
        float t          = Mathf.Clamp01(speed / Mathf.Max(maxHitVelocity, 0.01f));
        float speedScale = Mathf.Lerp(minSpeedScale, 1f, t);

        // 最终音量 = 整体音量 × 轻/重击比例 × 速度比例
        //   最小情况：masterVolume × lightVolumeScale × minSpeedScale
        //   例：1.0 × 0.65 × 0.55 = 0.36（始终可者）
        float hitScale   = isHeavy ? 1f : lightVolumeScale;
        float finalVol   = masterVolume * hitScale * speedScale;

        float pitch = isHeavy ? heavyPitch : lightPitch;

        AudioClip clip = isHeavy
            ? (heavyClip != null ? heavyClip : audioSource.clip)
            : (lightClip != null ? lightClip : audioSource.clip);

        if (clip == null)
        {
            Debug.LogWarning("[PlayerDrumHit] 没有可用的 AudioClip！");
            return;
        }

        audioSource.pitch = pitch;
        audioSource.PlayOneShot(clip, finalVol);

        if (showDebugLog)
            Debug.Log($"[PlayerDrumHit] {(isHeavy ? "重击" : "轻击")} " +
                      $"speed={speed:F2} speedScale={speedScale:F2} finalVol={finalVol:F2}");
    }

    // ─────────────────────────────────────────
    // 位置记录（Kinematic 速度估算用）
    void RecordPos(Collider col)
    {
        int id = col.GetInstanceID();
        if (!_posHistory.TryGetValue(id, out var buf))
        {
            buf = new (Vector3, float)[TRACK_FRAMES];
            _posHistory[id] = buf;
            _posHead[id]    = 0;
        }
        int head = _posHead[id];
        buf[head] = (col.transform.position, Time.time);
        _posHead[id] = (head + 1) % TRACK_FRAMES;
    }

    float EstimateSpeed(Collider col)
    {
        // 非 Kinematic → 直接用物理速度
        Rigidbody rb = col.attachedRigidbody;
        if (rb != null && !rb.isKinematic)
            return rb.linearVelocity.magnitude;

        // Kinematic / 无 RB → 位置差估算
        int id = col.GetInstanceID();
        if (!_posHistory.TryGetValue(id, out var buf)) return 0f;

        Vector3 oldest = Vector3.zero; float oldestT = float.MaxValue;
        Vector3 newest  = Vector3.zero; float newestT = float.MinValue;
        bool    hasData = false;

        foreach (var s in buf)
        {
            if (s.time <= 0f) continue;
            if (s.time < oldestT) { oldest = s.pos; oldestT = s.time; }
            if (s.time > newestT) { newest  = s.pos; newestT = s.time; }
            hasData = true;
        }

        if (!hasData) return 0f;
        float dt = newestT - oldestT;
        return dt > 0.0001f ? Vector3.Distance(newest, oldest) / dt : 0f;
    }
}
