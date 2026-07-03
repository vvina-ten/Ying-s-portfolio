using UnityEngine;
using System.Collections;

/// <summary>
/// 音频中心管理器（单例）
/// 
/// ★ 只需要一个 AudioClip 即可同时支持轻击/重击/急刹
///   - 轻击 = 低音量 + 略高音调
///   - 重击 = 满音量 + 正常音调
///   - 手碰触 = 可单独设置，也可复用同一 Clip
///
/// 挂载位置：鼓 GameObject（或场景中任意持久物体）
/// </summary>
public class DrumAudioManager : MonoBehaviour
{
    // ── 单例 ──
    public static DrumAudioManager Instance { get; private set; }

    [Header("── AudioSource ──")]
    public AudioSource drumAudioSource;

    [Header("── 音效 Clip（只需要一个就够）──")]
    [Tooltip("主鼓击音效（轻击和重击共用同一个 Clip）")]
    public AudioClip drumClip;

    [Tooltip("手碰鼓背面的音效；留空 = 自动复用 drumClip")]
    public AudioClip handTouchClip;

    [Header("── 轻击参数 ──")]
    [Range(0.1f, 1f)]
    [Tooltip("轻击的音量比例（建议 0.3 ~ 0.5）")]
    public float lightVolume = 0.35f;

    [Range(0.8f, 1.5f)]
    [Tooltip("轻击的音调（略高一点听起来更轻盈）")]
    public float lightPitch = 1.05f;

    [Header("── 重击参数 ──")]
    [Range(0.5f, 1f)]
    [Tooltip("重击的音量比例（建议 1.0）")]
    public float heavyVolume = 1.0f;

    [Range(0.7f, 1.2f)]
    [Tooltip("重击的音调（正常 = 1.0）")]
    public float heavyPitch = 1.0f;

    [Header("── 手碰触参数 ──")]
    [Range(0.1f, 1f)]
    public float handTouchVolume = 0.5f;

    [Range(0.8f, 1.3f)]
    public float handTouchPitch = 0.95f;

    [Header("── 整体音量 ──")]
    [Range(0f, 1f)]
    [Tooltip("整体音量系数；轻重比例保持不变")]
    public float masterVolume = 1f;

    [Header("── 速度感应 ──")]
    [Tooltip("鼓棒达到此速度（m/s）时为满音量；超过也不会超出最大音量")]
    public float maxHitVelocity = 4f;

    [Range(0f, 0.5f)]
    [Tooltip("速度接近 0 时的最低音量比例（0 = 完全无声，0.1 = 10% 音量）")]
    public float minVolumeRatio = 0.05f;

    [Header("── 急刹参数 ──")]
    [Range(0.02f, 0.3f)]
    [Tooltip("声音从当前音量降到 0 的时长（秒）；越小越干脆")]
    public float muteTime = 0.06f;

    // ── 内部 ──
    bool      _isMuting    = false;
    Coroutine _muteCoroutine;

    // ===== 生命周期 =====

    void Awake()
    {
        // ★ 允许多个实例共存（玩家鼓和教程鼓各自有独立的 DrumAudioManager）
        // 不再强制销毁多余实例；每个 DrumCollider / DrumFaceHit 在 Inspector
        // 里直接拖入自己对应的 DrumAudioManager，不依赖全局单例。
        if (Instance == null) Instance = this;
        // 如果已有其他实例，保留两者，不销毁
    }

    // ===== 公开接口 =====

    /// <summary>轻击：低音量 + 略高音调</summary>
    public void PlayLight()
    {
        if (_isMuting || drumClip == null) return;
        PlayClip(drumClip, lightVolume, lightPitch);
    }

    /// <summary>重击：满音量 + 正常音调</summary>
    public void PlayHeavy()
    {
        if (_isMuting || drumClip == null) return;
        PlayClip(drumClip, heavyVolume, heavyPitch);
    }

    /// <summary>
    /// 按鼓棒速度动态缩放音量
    /// speed=0 → minVolumeRatio；speed≥maxHitVelocity → 轻/重击满音量
    /// </summary>
    public void PlayByVelocity(float speed, bool isHeavy)
    {
        if (_isMuting || drumClip == null) return;

        float t     = Mathf.Clamp01(speed / Mathf.Max(maxHitVelocity, 0.01f));
        float ratio = Mathf.Lerp(minVolumeRatio, 1f, t);

        float vol   = (isHeavy ? heavyVolume : lightVolume) * ratio;
        float pitch = isHeavy ? heavyPitch : lightPitch;
        PlayClip(drumClip, vol, pitch);
    }

    /// <summary>手碰鼓背面瞬间的碰触音</summary>
    public void PlayHandTouch()
    {
        if (_isMuting) return;
        AudioClip clip = handTouchClip != null ? handTouchClip : drumClip;
        if (clip == null) return;
        PlayClip(clip, handTouchVolume, handTouchPitch);
    }

    /// <summary>
    /// 急刹：将当前声音在 muteTime 内快速淡出到 0，然后停止
    /// 同时中断所有声音（含手碰触音）
    /// </summary>
    public void MuteAll()
    {
        if (_isMuting) return;
        if (_muteCoroutine != null) StopCoroutine(_muteCoroutine);
        _muteCoroutine = StartCoroutine(MuteCoroutine());
    }

    // ===== 内部辅助 =====

    /// <summary>UI Slider.onValueChanged 直接挂这个方法</summary>
    public void SetMasterVolume(float v)
    {
        masterVolume = Mathf.Clamp01(v);
    }

    void PlayClip(AudioClip clip, float volume, float pitch)
    {
        if (drumAudioSource == null) return;

        drumAudioSource.pitch = pitch;
        // PlayOneShot 不强制截断正在播的波形，避免循环衔接时的爆破音
        drumAudioSource.PlayOneShot(clip, volume * masterVolume);
    }

    IEnumerator MuteCoroutine()
    {
        _isMuting = true;

        float startVol = drumAudioSource != null ? drumAudioSource.volume : 0f;
        float elapsed  = 0f;

        while (elapsed < muteTime)
        {
            if (drumAudioSource != null)
                drumAudioSource.volume = Mathf.Lerp(startVol, 0f, elapsed / muteTime);

            elapsed += Time.deltaTime;
            yield return null;
        }

        if (drumAudioSource != null)
        {
            drumAudioSource.Stop();
            drumAudioSource.volume = heavyVolume; // 复原为重击默认音量
            drumAudioSource.pitch  = heavyPitch;
        }

        _isMuting      = false;
        _muteCoroutine = null;
    }
}
