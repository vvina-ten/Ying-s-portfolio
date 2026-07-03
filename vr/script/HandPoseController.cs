using UnityEngine;
using UnityEngine.InputSystem;

/// <summary>
/// 根据手柄按键切换手部姿势
///
/// 优先级：Grip（中指）> Trigger（食指）> 默认
///
/// 挂载位置：玩家手部模型 GameObject
/// </summary>
public class HandPoseController : MonoBehaviour
{
    [Header("── 手部 Animator ──")]
    public Animator handAnimator;
    [Tooltip("Animator 里控制姿势的 int 参数名")]
    public string poseParam = "PoseIndex";

    [Header("── 按键输入 ──")]
    [Tooltip("食指 Trigger（双指敲击鼓背）")]
    public InputActionReference triggerAction;   // Index Trigger

    [Tooltip("中指 Grip（抓取鼓）")]
    public InputActionReference gripAction;      // Grip

    [Header("── 按键阈值 ──")]
    [Range(0.1f, 0.9f)]
    [Tooltip("Trigger/Grip 值超过此值才切换姿势")]
    public float threshold = 0.5f;

    // ── 姿势编号（与 Animator 里的值对应）──
    const int POSE_IDLE       = 0;  // 什么都不按
    const int POSE_TWO_FINGER = 1;  // 食指 Trigger
    const int POSE_GRAB       = 2;  // 中指 Grip

    // ===== 生命周期 =====

    void OnEnable()
    {
        triggerAction?.action.Enable();
        gripAction?.action.Enable();
    }

    void OnDisable()
    {
        triggerAction?.action.Disable();
        gripAction?.action.Disable();
    }

    void Update()
    {
        if (handAnimator == null) return;

        float trigger = triggerAction != null
            ? triggerAction.action.ReadValue<float>() : 0f;
        float grip = gripAction != null
            ? gripAction.action.ReadValue<float>() : 0f;

        // 优先级：Grip > Trigger > Idle
        int pose;
        if (grip > threshold)
            pose = POSE_GRAB;
        else if (trigger > threshold)
            pose = POSE_TWO_FINGER;
        else
            pose = POSE_IDLE;

        handAnimator.SetInteger(poseParam, pose);
    }
}
