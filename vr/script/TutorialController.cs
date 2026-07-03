using UnityEngine;
using UnityEngine.InputSystem;
using UnityEngine.UI;
using System.Collections;

/// <summary>
/// 教程播放控制器
/// - useButton = false（默认）：进游戏自动播放动画
/// - useButton = true          ：按下指定按键才播放
///
/// ★ 同时包含 Animation Event 回调方法
///   在 Animation 窗口的关键帧上添加 Event，选择对应函数名即可精确触发声音
///
/// 挂载位置：TutorialRig（Animator 所在物体）
/// </summary>
public class TutorialController : MonoBehaviour
{
    [Header("── 动画 ──")]
    public Animator animator;
    public string   stateName = "TutorialPlay";

    [Header("── 按键模式 ──")]
    [Tooltip("勾上 = 按键才播；不勾 = 进游戏自动播")]
    public bool useButton = false;
    public InputActionReference playButton;

    [Header("── 按键循环控制 ──")]
    [Tooltip("拖入对应的 Canvas Button；留空则不控制按键状态")]
    public Button canvasButton;
    [Tooltip("动画循环几次后结束并恢复按键")]
    public int loopCount = 12;

    [Header("── 音频（Animation Event 用）──")]
    [Tooltip("DrumAudioManager 所在物体；留空则自动找单例")]
    public DrumAudioManager audioManager;

    bool _isPlaying = false;
    Coroutine _loopCoroutine;

    void OnEnable()
    {
        if (useButton && playButton != null)
            playButton.action.Enable();
    }

    void OnDisable()
    {
        if (useButton && playButton != null)
            playButton.action.Disable();
    }

    void Start()
    {
        if (audioManager == null)
            audioManager = DrumAudioManager.Instance;

        if (!useButton)
            Play();
        else
            ResetToFirstFrame();
    }

    void Update()
    {
        if (useButton && playButton != null &&
            playButton.action.WasPressedThisFrame())
        {
            if (_isPlaying) Stop();
            else            Play();
        }
    }

    // ===== 动画播放控制 =====

    public void Play()
    {
        if (animator == null || _isPlaying) return;
        animator.speed = 1f;
        animator.Play(stateName, 0, 0f);

        if (canvasButton != null)
        {
            if (_loopCoroutine != null) StopCoroutine(_loopCoroutine);
            _loopCoroutine = StartCoroutine(WaitLoops());
        }
        else
        {
            _isPlaying = true;
        }
    }

    public void Stop()
    {
        if (animator == null) return;
        animator.StopPlayback();
        _isPlaying = false;
    }

    public void ResetToFirstFrame()
    {
        if (animator == null) return;
        animator.Play(stateName, 0, 0f);
        animator.speed = 0f;
        _isPlaying = false;
    }

    IEnumerator WaitLoops()
    {
        _isPlaying = true;
        canvasButton.interactable = false;

        yield return null; // 等一帧让 Animator 启动

        float clipLength = GetClipLength();
        float waitTime = clipLength > 0f ? clipLength * loopCount : 5f;
        yield return new WaitForSeconds(waitTime);

        ResetToFirstFrame();

        canvasButton.interactable = true;
        _isPlaying = false;
        _loopCoroutine = null;
    }

    float GetClipLength()
    {
        if (animator == null) return 0f;
        AnimatorClipInfo[] info = animator.GetCurrentAnimatorClipInfo(0);
        return info.Length > 0 ? info[0].clip.length : 0f;
    }

    // ===== Animation Event 回调 =====

    public void Event_PlayLight()      { audioManager?.PlayLight();      }
    public void Event_PlayHeavy()      { audioManager?.PlayHeavy();      }
    public void Event_PlayHandTouch()  { audioManager?.PlayHandTouch();  }
    public void Event_MuteAll()        { audioManager?.MuteAll();        }
}
