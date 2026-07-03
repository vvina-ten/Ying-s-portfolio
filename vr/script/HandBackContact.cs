using UnityEngine;
using System.Collections;

/// <summary>
/// 手接触鼓背面：碰触音 + 急刹序列
///
/// 完整时序：
///   手进入 → 立刻播 PlayHandTouch()
///   手持续接触 holdDuration 秒 → MuteAll()（急刹，含 handTouch 的声音）
///   手提前离开 → 取消倒计时，不急刹
///
/// 挂载位置：鼓背面的薄层 Trigger GameObject（独立于鼓面正面）
/// 需要组件：Collider（IsTrigger = true）
/// </summary>
public class HandBackContact : MonoBehaviour
{
    [Header("── 引用 ──")]
    [Tooltip("DrumAudioManager 脚本；留空则自动查找单例")]
    public DrumAudioManager audioManager;

    [Header("── 识别标签 ──")]
    [Tooltip("手 / 手模型 GameObject 的 Tag")]
    public string handTag = "Hand";

    [Header("── 急刹触发时间 ──")]
    [Range(0.1f, 3f)]
    [Tooltip("手接触鼓面后多少秒触发急刹（0.5 = 默认）")]
    public float holdDuration = 0.5f;

    [Header("── 调试 ──")]
    public bool showDebugLog = false;

    // ── 内部 ──
    bool      _handInContact = false;
    Coroutine _holdCoroutine;

    // ===== 生命周期 =====

    void Start()
    {
        if (audioManager == null)
            audioManager = DrumAudioManager.Instance;

        if (audioManager == null)
            Debug.LogWarning("[HandBackContact] 找不到 DrumAudioManager！");
    }

    // ===== Trigger 事件 =====

    void OnTriggerEnter(Collider other)
    {
        if (!other.CompareTag(handTag)) return;

        _handInContact = true;

        if (showDebugLog)
            Debug.Log("[HandBackContact] 手进入鼓背面 → 播碰触音，开始倒计时");

        // 1. 立刻播碰触音
        audioManager?.PlayHandTouch();

        // 2. 开始急刹倒计时（如果已有则重置）
        if (_holdCoroutine != null)
            StopCoroutine(_holdCoroutine);

        _holdCoroutine = StartCoroutine(HoldAndMute());
    }

    void OnTriggerExit(Collider other)
    {
        if (!other.CompareTag(handTag)) return;

        _handInContact = false;

        // 手离开 → 取消急刹倒计时
        if (_holdCoroutine != null)
        {
            StopCoroutine(_holdCoroutine);
            _holdCoroutine = null;

            if (showDebugLog)
                Debug.Log("[HandBackContact] 手离开，急刹取消");
        }
    }

    // ===== 内部协程 =====

    IEnumerator HoldAndMute()
    {
        if (showDebugLog)
            Debug.Log($"[HandBackContact] 倒计时 {holdDuration}s ...");

        yield return new WaitForSeconds(holdDuration);

        // 再次确认手还在
        if (_handInContact)
        {
            if (showDebugLog)
                Debug.Log("[HandBackContact] 急刹触发！MuteAll()");

            audioManager?.MuteAll();
        }

        _holdCoroutine = null;
    }

}
