using UnityEngine;
using System.Collections;
using System.Collections.Generic;
using UnityEngine.XR;

/// <summary>
/// 鼓的统一碰撞处理器（单 Collider 版）
///
/// 一个 Collider 检测两种碰撞：
///   碰到 鼓棒（drumstickTag）→ 判断轻/重击，发声
///   碰到 手  （handTag）     → 播碰触音，计时后急刹
///
/// 挂载位置：鼓的 Collider GameObject
/// 需要组件：Collider（IsTrigger = true）
/// </summary>
public class DrumCollider : MonoBehaviour
{
    [Header("── 引用 ──")]
    [Tooltip("DrumAudioManager；留空则自动查找单例")]
    public DrumAudioManager audioManager;

    [Tooltip("HeavyHitZone 脚本（决定轻/重击）")]
    public HeavyHitZone heavyZone;

    [Header("── 识别标签 ──")]
    public string drumstickTag = "Drumstick";
    public string handTag      = "Hand";

    [Header("── 鼓棒：重击时间窗口 ──")]
    [Tooltip("敲鼓前多少秒内经过 HeavyZone 才算重击")]
    public float heavyTimeWindow = 0.4f;

    [Tooltip("防同一次碰撞重复触发的冷却时间")]
    [Range(0.05f, 0.5f)]
    public float drumstickCooldown = 0.15f;

    [Header("── 方向检测 ──")]
    [Tooltip("勾上后只接受从外往里的击打，防止弹回穿越触发")]
    public bool checkHitDirection = true;

    [Tooltip("鼓面朝外的本地轴方向；默认 up(0,1,0)，即本地 Y 轴朝向鼓棒来源")]
    public Vector3 outsideAxisLocal = Vector3.up;

    [Tooltip("持鼓棒的手（用于读 IMU 速度，Kinematic 也能读到）")]
    public UnityEngine.XR.XRNode drumstickHand = UnityEngine.XR.XRNode.RightHand;

    [Header("── 手：急刹参数 ──")]
    [Range(0.1f, 3f)]
    [Tooltip("手接触鼓多少秒后触发急刹")]
    public float holdDuration = 0.5f;

    [Header("── 手柄震动 ──")]
    [Tooltip("重击震动幅度 0‒1")]
    [Range(0f, 1f)] public float heavyHapticAmplitude = 0.8f;

    [Tooltip("轻击震动幅度 0‒1")]
    [Range(0f, 1f)] public float lightHapticAmplitude  = 0.35f;

    [Tooltip("震动持续时间（秒）")]
    [Range(0.02f, 0.3f)] public float hapticDuration   = 0.12f;

    [Tooltip("震动发给哪只手；鼓通常由左手持握，所以默认左手")]
    public XRNode hapticNode = XRNode.LeftHand;

    [Header("── 调试 ──")]
    public bool showDebugLog = false;

    [Header("── 启动保护 ──")]
    [Tooltip("游戏开始后多少秒内忽略碰撞")]
    public float startupIgnoreTime = 0.5f;

    // ── 内部状态 ──
    float     _lastDrumstickHit = -9999f;
    bool      _handInContact    = false;
    int       _handContactCount = 0;      // 多碰撞体计数
    Coroutine _holdCoroutine;

    // 位置历史（兼容 Kinematic 的速度估算，此处已不用于音量但保留用于 Debug）
    readonly Dictionary<int, (Vector3 pos, float time)[]> _posHistory
        = new Dictionary<int, (Vector3, float)[]>();
    readonly Dictionary<int, int> _posHead = new Dictionary<int, int>();

    // ===== 生命周期 =====

    void Start()
    {
        if (audioManager == null)
            audioManager = GetComponentInParent<DrumAudioManager>();
        if (audioManager == null)
            audioManager = DrumAudioManager.Instance;

        if (audioManager == null)
            Debug.LogWarning("[DrumCollider] 找不到 DrumAudioManager！");

        _lastDrumstickHit = Time.time + startupIgnoreTime;
    }

    // ===== 统一 Trigger 入口 =====

    void OnTriggerEnter(Collider other)
    {
        if (other.CompareTag(drumstickTag))
        {
            // 方向检测：只接受从外往里的击打（弹回时速度朝外，自动拒绝）
            if (checkHitDirection && !IsApproachingFromOutside()) return;
            RecordPos(other);
            HandleDrumstickHit(other);
        }
        else if (other.CompareTag(handTag))
            HandleHandEnter();
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
        else if (other.CompareTag(handTag))
            HandleHandExit();
    }

    // ===== 方向检测（基于控制器 IMU 速度，Kinematic 也有效）=====

    bool IsApproachingFromOutside()
    {
        var devices = new List<UnityEngine.XR.InputDevice>();
        UnityEngine.XR.InputDevices.GetDevicesAtXRNode(drumstickHand, devices);

        if (devices.Count > 0 &&
            devices[0].TryGetFeatureValue(UnityEngine.XR.CommonUsages.deviceVelocity, out Vector3 vel) &&
            vel.sqrMagnitude > 0.04f)   // 速度太小时不判断（静止状态）
        {
            Vector3 worldOutside = transform.TransformDirection(outsideAxisLocal);
            // 速度朝内（和外法线反向）= 从外往里 = 有效击打
            // 阈值 0.3f：允许斜向敲击，只拒绝明显往外弹的情况
            return Vector3.Dot(vel.normalized, worldOutside) < 0.3f;
        }

        return true; // 无法读速度时放行（兼容非 Quest 设备）
    }

    // ===== 鼓棒：轻/重击 =====

    void HandleDrumstickHit(Collider other)
    {
        if (Time.time - _lastDrumstickHit < drumstickCooldown) return;
        _lastDrumstickHit = Time.time;

        // ConsumeAndCheck：每次 heavyzone 通过只用一次，快速连击不会共用同一次通过
        bool isHeavy = heavyZone != null && heavyZone.ConsumeAndCheck(heavyTimeWindow);

        if (showDebugLog)
            Debug.Log($"[DrumCollider] 鼓棒 → {(isHeavy ? "重击" : "轻击")}");

        if (isHeavy)
        {
            audioManager?.PlayHeavy();
            SendHaptic(hapticNode, heavyHapticAmplitude, hapticDuration);
        }
        else
        {
            audioManager?.PlayLight();
            SendHaptic(hapticNode, lightHapticAmplitude, hapticDuration);
        }
    }

    // ===== 手：碰触音 + 急刹倒计时（多碰撞体安全版）=====

    void HandleHandEnter()
    {
        _handContactCount++;
        if (_handContactCount > 1) return; // 已有碰撞体在内，不重复触发

        _handInContact = true;
        if (showDebugLog) Debug.Log("[DrumCollider] 手碰鼓 → 碰触音 + 倒计时");

        audioManager?.PlayHandTouch();

        if (_holdCoroutine != null) StopCoroutine(_holdCoroutine);
        _holdCoroutine = StartCoroutine(HoldAndMute());
    }

    void HandleHandExit()
    {
        _handContactCount = Mathf.Max(0, _handContactCount - 1);
        if (_handContactCount > 0) return; // 还有其他碰撞体在内，继续保持接触

        _handInContact = false;
        if (_holdCoroutine != null)
        {
            StopCoroutine(_holdCoroutine);
            _holdCoroutine = null;
            if (showDebugLog) Debug.Log("[DrumCollider] 手离开，急刹取消");
        }
    }

    IEnumerator HoldAndMute()
    {
        yield return new WaitForSeconds(holdDuration);
        if (_handInContact)
        {
            if (showDebugLog) Debug.Log("[DrumCollider] 急刹触发！");
            audioManager?.MuteAll();
        }
        _holdCoroutine = null;
    }

    // ===== 手柄震动 =====

    static void SendHaptic(XRNode node, float amplitude, float duration)
    {
        var devices = new List<InputDevice>();
        InputDevices.GetDevicesAtXRNode(node, devices);
        foreach (var d in devices)
            d.SendHapticImpulse(0, Mathf.Clamp01(amplitude), duration);
    }

    // ===== 速度估算（保留，供未来扩展）=====

    void RecordPos(Collider col)
    {
        int id = col.GetInstanceID();
        if (!_posHistory.TryGetValue(id, out var buf))
        {
            buf = new (Vector3, float)[4];
            _posHistory[id] = buf;
            _posHead[id]    = 0;
        }
        int head = _posHead[id];
        buf[head] = (col.transform.position, Time.time);
        _posHead[id] = (head + 1) % 4;
    }
}
