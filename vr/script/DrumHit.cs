using UnityEngine;
using UnityEngine.InputSystem;
using UnityEngine.UI;
using System.Collections;

public class DrumHit : MonoBehaviour
{
    [Header("引用(拖进来)")]
    public Animator animator;
    public AudioSource audioSource;
    public string stateName = "DrumHit";

    [Header("模式")]
    public bool useButton = false;
    public InputActionReference buttonAction;

    [Header("── 按键循环控制 ──")]
    [Tooltip("拖入对应的 Canvas Button；留空则不控制按键状态")]
    public Button playButton;
    [Tooltip("动画循环几次后结束并恢复按键")]
    public int loopCount = 12;

    bool _isPlaying = false;
    Coroutine _loopCoroutine;

    void OnEnable()  { if (buttonAction != null) buttonAction.action.Enable();  }
    void OnDisable() { if (buttonAction != null) buttonAction.action.Disable(); }

    void Start()
    {
        // 初始化：让 Animator 暂停在第 0 帧，等待真实触发
        if (animator != null) animator.speed = 0f;
        // ⚠️ 原来此处有 if (!useButton) PlayHit();
        //    会导致 Play 一按就自动播放鼓声，已移除。
    }

    void Update()
    {
        if (useButton && buttonAction != null && buttonAction.action.WasPressedThisFrame())
            PlayHit();
    }

    public void PlayHit()
    {
        if (_isPlaying) return;

        if (animator != null)
        {
            animator.speed = 1f;
            animator.Play(stateName, 0, 0f);
        }

        if (audioSource != null)
        {
            audioSource.Stop();
            audioSource.Play();
        }

        if (playButton != null)
        {
            if (_loopCoroutine != null) StopCoroutine(_loopCoroutine);
            _loopCoroutine = StartCoroutine(WaitLoops());
        }
    }

    IEnumerator WaitLoops()
    {
        _isPlaying = true;
        playButton.interactable = false;

        yield return null; // 等一帧让 Animator 启动

        float clipLength = GetClipLength();
        float waitTime = clipLength > 0f ? clipLength * loopCount : 5f;
        yield return new WaitForSeconds(waitTime);

        if (animator != null)
        {
            animator.Play(stateName, 0, 0f);
            animator.speed = 0f;
        }

        playButton.interactable = true;
        _isPlaying = false;
        _loopCoroutine = null;
    }

    float GetClipLength()
    {
        if (animator == null) return 0f;
        AnimatorClipInfo[] info = animator.GetCurrentAnimatorClipInfo(0);
        return info.Length > 0 ? info[0].clip.length : 0f;
    }
}
