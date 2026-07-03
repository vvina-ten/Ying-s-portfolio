using UnityEngine;
using System.Collections;
using UnityEngine.XR.Interaction.Toolkit;
using UnityEngine.XR.Interaction.Toolkit.Interactables;

/// <summary>
/// VR 教程按键（Raycast 版）
///
/// 交互方式：手柄射线指向按键 → 按 Trigger → 触发
/// 需要组件：XRSimpleInteractable + Collider（非Trigger）
///
/// 挂载位置：每个按键 GameObject
/// </summary>
[RequireComponent(typeof(XRSimpleInteractable))]
public class TutorialButton : MonoBehaviour
{
    // ===================================================
    //  引用
    // ===================================================

    [Header("── 教程控制器 ──")]
    [Tooltip("这个按键对应的 TutorialController")]
    public TutorialController tutorialController;

    // ===================================================
    //  按键视觉
    // ===================================================

    [Header("── 按键视觉 ──")]
    [Tooltip("按键的 Renderer；留空则跳过颜色变化")]
    public Renderer buttonRenderer;

    [Tooltip("正常亮起颜色")]
    public Color activeColor   = new Color(0.2f, 0.8f, 1f);

    [Tooltip("变灰颜色（播放中不可按）")]
    public Color inactiveColor = new Color(0.3f, 0.3f, 0.3f);

    [Tooltip("（可选）亮起时开灯，变灰时关灯")]
    public Light buttonLight;

    [Tooltip("（可选）亮起时显示的子物体（如发光环）")]
    public GameObject glowObject;

    // ===================================================
    //  播放参数
    // ===================================================

    public enum PlayMode
    {
        Duration,   // 按时间
        Loops       // 按循环次数
    }

    [Header("── 播放模式 ──")]
    public PlayMode playMode = PlayMode.Duration;

    [Tooltip("【Duration】播放多少秒")]
    public float playDuration = 6f;

    [Tooltip("【Loops】循环几次")]
    public int loopCount = 12;

    // ===================================================
    //  内部状态
    // ===================================================

    bool      _isPlaying   = false;
    Coroutine _playCoroutine;
    XRSimpleInteractable _interactable;

    // ===================================================
    //  初始化：监听 XRI 事件
    // ===================================================

    void Awake()
    {
        _interactable = GetComponent<XRSimpleInteractable>();
    }

    void OnEnable()
    {
        // 手柄射线按下 Trigger 时触发
        _interactable.selectEntered.AddListener(OnPressed);
    }

    void OnDisable()
    {
        _interactable.selectEntered.RemoveListener(OnPressed);
    }

    void Start()
    {
        SetButtonActive(true); // 初始亮起
    }

    // ===================================================
    //  按键被按下
    // ===================================================

    void OnPressed(SelectEnterEventArgs args)
    {
        if (_isPlaying) return; // 正在播放时忽略

        StartTutorial();
    }

    // ===================================================
    //  开始教程
    // ===================================================

    void StartTutorial()
    {
        if (tutorialController == null)
        {
            Debug.LogWarning($"[TutorialButton] {name} 没有绑定 TutorialController！");
            return;
        }

        _isPlaying = true;
        SetButtonActive(false);    // 按键变灰
        tutorialController.Play(); // 播放动画

        if (_playCoroutine != null) StopCoroutine(_playCoroutine);

        _playCoroutine = playMode == PlayMode.Duration
            ? StartCoroutine(WaitByDuration())
            : StartCoroutine(WaitByLoops());
    }

    // ===================================================
    //  等待：按时间
    // ===================================================

    IEnumerator WaitByDuration()
    {
        yield return new WaitForSeconds(playDuration);
        EndTutorial();
    }

    // ===================================================
    //  等待：按循环次数
    // ===================================================

    IEnumerator WaitByLoops()
    {
        yield return null; // 等一帧让 Animator 启动

        float clipLength = GetCurrentClipLength();

        if (clipLength <= 0f)
        {
            Debug.LogWarning("[TutorialButton] 无法读取 clip 长度，改用 Duration");
            yield return new WaitForSeconds(playDuration);
        }
        else
        {
            yield return new WaitForSeconds(clipLength * loopCount);
        }

        EndTutorial();
    }

    // ===================================================
    //  结束教程
    // ===================================================

    void EndTutorial()
    {
        tutorialController.ResetToFirstFrame();

        _isPlaying     = false;
        _playCoroutine = null;

        SetButtonActive(true); // 按键亮起
    }

    // ===================================================
    //  视觉状态
    // ===================================================

    void SetButtonActive(bool active)
    {
        if (buttonRenderer != null)
        {
            buttonRenderer.material.color = active ? activeColor : inactiveColor;

            if (buttonRenderer.material.HasProperty("_EmissionColor"))
            {
                Color emit = active ? activeColor * 1.5f : Color.black;
                buttonRenderer.material.SetColor("_EmissionColor", emit);
            }
        }

        if (buttonLight  != null) buttonLight.enabled   = active;
        if (glowObject   != null) glowObject.SetActive(active);
    }

    // ===================================================
    //  读取当前 Clip 长度
    // ===================================================

    float GetCurrentClipLength()
    {
        if (tutorialController?.animator == null) return 0f;

        AnimatorClipInfo[] info =
            tutorialController.animator.GetCurrentAnimatorClipInfo(0);

        return info.Length > 0 ? info[0].clip.length : 0f;
    }

#if UNITY_EDITOR
    void OnDrawGizmosSelected()
    {
        Gizmos.color = Color.yellow;
        var col = GetComponent<Collider>();
        if (col != null)
            Gizmos.DrawWireCube(col.bounds.center, col.bounds.size);
    }
#endif
}
