using UnityEngine;
using System.Collections.Generic;
using UnityEngine.XR;

/// <summary>
/// 重击区域追踪器
///
/// 逻辑：鼓棒从上往下经过此区域 → 记录时间戳（一次性）
///       DrumCollider.ConsumeAndCheck() 询问并消费这次通过
///
/// 双重防护防止弹回误触：
///   1. IMU 速度方向检测：弹回时速度朝上 → 拒绝
///   2. 入场冷却：记录后 entryCooldown 秒内再次入场 → 拒绝
/// </summary>
public class HeavyHitZone : MonoBehaviour
{
    [Header("── 识别标签 ──")]
    public string drumstickTag = "Drumstick";

    [Header("── 方向过滤 ──")]
    [Tooltip("勾上后只记录从正确方向经过的（防止弹回重新触发）")]
    public bool checkEntryDirection = true;

    [Tooltip("鼓面朝外的本地轴方向（与 DrumCollider 保持一致）；默认 up(0,1,0)")]
    public Vector3 outsideAxisLocal = Vector3.up;

    [Tooltip("持鼓棒的手（用于读 IMU 速度）")]
    public XRNode drumstickHand = XRNode.RightHand;

    [Header("── 入场冷却 ──")]
    [Tooltip("记录一次有效通过后，冷却多少秒再允许下一次（覆盖弹回时间）")]
    [Range(0.1f, 0.5f)]
    public float entryCooldown = 0.25f;

    [Header("── 调试 ──")]
    public bool showDebugLog = false;

    float _lastTouchTime = -9999f;
    float _stayDeadline  = -9999f;
    float _cooldownEnd   = -9999f;

    // ===== Trigger 事件 =====

    void OnTriggerEnter(Collider other)
    {
        if (!other.CompareTag(drumstickTag)) return;

        // 冷却中（弹回太快）→ 忽略
        if (Time.time < _cooldownEnd) return;

        // 方向检测：速度方向必须朝"内"（往鼓面方向），弹回时朝"外"会被拒绝
        if (checkEntryDirection && !IsValidDirection()) return;

        _lastTouchTime = Time.time;
        _stayDeadline  = Time.time + 0.12f;
        _cooldownEnd   = Time.time + entryCooldown;

        if (showDebugLog)
            Debug.Log($"[HeavyHitZone] ✓ 有效经过 @ {_lastTouchTime:F3}s");
    }

    void OnTriggerStay(Collider other)
    {
        if (!other.CompareTag(drumstickTag)) return;
        // 只在入场后 0.12s 内刷新（防丢帧），不无限刷新
        if (Time.time <= _stayDeadline)
            _lastTouchTime = Time.time;
    }

    void OnTriggerExit(Collider other)
    {
        if (!other.CompareTag(drumstickTag)) return;
        _stayDeadline = -9999f;
    }

    // ===== 方向检测 =====

    bool IsValidDirection()
    {
        var devices = new List<InputDevice>();
        InputDevices.GetDevicesAtXRNode(drumstickHand, devices);

        if (devices.Count > 0 &&
            devices[0].TryGetFeatureValue(CommonUsages.deviceVelocity, out Vector3 vel) &&
            vel.sqrMagnitude > 0.04f)
        {
            Vector3 worldOutside = transform.TransformDirection(outsideAxisLocal);
            // 速度方向与"外法线"反向 = 往内运动 = 从外往里 = 有效下击
            return Vector3.Dot(vel.normalized, worldOutside) < -0.2f;
        }

        return true; // 无法读速度时放行
    }

    // ===== 公开查询接口 =====

    /// <summary>
    /// 消费式查询：命中则返回 true 并立即重置时间戳，
    /// 同一次通过只能被一次击打使用。
    /// </summary>
    public bool ConsumeAndCheck(float seconds)
    {
        if ((Time.time - _lastTouchTime) <= seconds)
        {
            _lastTouchTime = -9999f;
            return true;
        }
        return false;
    }

    /// <summary>只查询不消费。</summary>
    public bool WasTouchedWithin(float seconds)
    {
        return (Time.time - _lastTouchTime) <= seconds;
    }
}
