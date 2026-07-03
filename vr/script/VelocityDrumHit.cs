using UnityEngine;
using System.Collections.Generic;
using UnityEngine.XR;

/// <summary>
/// testDRUM 击打检测（速度阈值版 + 独立 AudioSource）
///
/// 逻辑：OnTriggerEnter 时读 IMU 速度峰值
///   速度 >= heavyThreshold → 重击
///   速度 <  heavyThreshold → 轻击
///   速度 <  minSpeed       → 忽略（鼓棒静止抖动）
///
/// 音频用两个私有 AudioSource（Awake 自动创建），
/// 外部任何脚本都无法 Stop() 打断它们。
/// </summary>
public class VelocityDrumHit : MonoBehaviour
{
    [Header("── 音频 ──")]
    public AudioClip lightClip;
    public AudioClip heavyClip;
    [Range(0f, 1f)] public float lightVolume  = 0.9f;
    [Range(0f, 1f)] public float heavyVolume  = 1.0f;
    [Tooltip("0 = 纯2D全场可听，1 = 3D距离衰减")]
    [Range(0f, 1f)] public float spatialBlend = 0f;

    [Header("── 控制器 ──")]
    public XRNode drumstickHand = XRNode.RightHand;
    public string drumstickTag  = "PlayerStick";

    [Header("── 速度阈值 ──")]
    [Tooltip("低于此速度视为静止抖动，不发声")]
    public float minSpeed       = 0.15f;
    [Tooltip("速度 >= 此值 = 重击，否则轻击")]
    public float heavyThreshold = 0.8f;

    [Header("── 峰值采样 ──")]
    [Tooltip("OnTriggerEnter 前回溯多少帧取峰值速度（推荐 4-8）")]
    [Range(2, 15)]
    public int lookbackFrames = 6;

    [Header("── 方向过滤（防弹回）──")]
    public bool    checkDirection   = true;
    [Tooltip("鼓面朝外本地轴，默认 up")]
    public Vector3 outsideAxisLocal = Vector3.up;

    [Header("── 防重复触发 ──")]
    [Range(0.05f, 0.5f)] public float cooldown          = 0.12f;
    public float                      startupIgnoreTime = 0.5f;

    [Header("── 手柄震动 ──")]
    [Range(0f, 1f)]      public float lightHaptic    = 0.3f;
    [Range(0f, 1f)]      public float heavyHaptic    = 0.8f;
    [Range(0.02f, 0.3f)] public float hapticDuration = 0.1f;

    [Header("── 调试 ──")]
    public bool showDebugLog = true;

    // ── 内部 ──
    float       _lastHitTime = -9999f;
    AudioSource _lightSrc;
    AudioSource _heavySrc;
    readonly Queue<float> _speedHistory = new Queue<float>();

    // ===== 生命周期 =====

    void Awake()
    {
        _lightSrc              = gameObject.AddComponent<AudioSource>();
        _lightSrc.playOnAwake  = false;
        _lightSrc.spatialBlend = spatialBlend;

        _heavySrc              = gameObject.AddComponent<AudioSource>();
        _heavySrc.playOnAwake  = false;
        _heavySrc.spatialBlend = spatialBlend;
    }

    void Start()
    {
        _lastHitTime = Time.time + startupIgnoreTime;
    }

    void FixedUpdate()
    {
        _speedHistory.Enqueue(GetRawVelocity().magnitude);
        while (_speedHistory.Count > lookbackFrames)
            _speedHistory.Dequeue();
    }

    // ===== 触发检测 =====

    void OnTriggerEnter(Collider other)
    {
        if (!other.CompareTag(drumstickTag)) return;
        if (Time.time - _lastHitTime < cooldown) return;

        // 弹回过滤
        if (checkDirection)
        {
            Vector3 vel = GetRawVelocity();
            if (vel.sqrMagnitude > 0.01f)
            {
                Vector3 worldOutside = transform.TransformDirection(outsideAxisLocal);
                float   dot          = Vector3.Dot(vel.normalized, worldOutside);
                if (dot > 0.5f)
                {
                    if (showDebugLog) Debug.Log($"[DrumHit] 弹回(dot={dot:F2})，忽略");
                    return;
                }
            }
        }

        // 峰值速度
        float peak = 0f;
        foreach (float s in _speedHistory)
            if (s > peak) peak = s;

        if (peak < minSpeed)
        {
            if (showDebugLog) Debug.Log($"[DrumHit] peak={peak:F2} < minSpeed，忽略");
            return;
        }

        _lastHitTime = Time.time;
        _speedHistory.Clear();

        bool isHeavy = peak >= heavyThreshold;

        if (showDebugLog) Debug.Log($"[DrumHit] peak={peak:F2} → {(isHeavy ? "重击" : "轻击")}");

        if (isHeavy)
        {
            _heavySrc?.PlayOneShot(heavyClip, heavyVolume);
            SendHaptic(drumstickHand, heavyHaptic, hapticDuration);
        }
        else
        {
            _lightSrc?.PlayOneShot(lightClip, lightVolume);
            SendHaptic(drumstickHand, lightHaptic, hapticDuration);
        }
    }

    // ===== 工具 =====

    Vector3 GetRawVelocity()
    {
        var devices = new List<InputDevice>();
        InputDevices.GetDevicesAtXRNode(drumstickHand, devices);
        if (devices.Count > 0 &&
            devices[0].TryGetFeatureValue(CommonUsages.deviceVelocity, out Vector3 vel))
            return vel;
        return Vector3.zero;
    }

    static void SendHaptic(XRNode node, float amplitude, float duration)
    {
        var devices = new List<InputDevice>();
        InputDevices.GetDevicesAtXRNode(node, devices);
        foreach (var d in devices)
            d.SendHapticImpulse(0, Mathf.Clamp01(amplitude), duration);
    }
}
