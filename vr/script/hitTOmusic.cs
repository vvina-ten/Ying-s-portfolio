/*
using UnityEngine;

// 把这个脚本挂在 tag 为 "D" 的物体上
// Attach this script to the GameObject with tag "D"
[RequireComponent(typeof(AudioSource))]
public class hitTOmusic : MonoBehaviour
{
    private AudioSource audioSource;

    void Start()
    {
        audioSource = GetComponent<AudioSource>();
    }

    // 使用 Trigger（需要其中一个物体有 Is Trigger 勾选）
    void OnTriggerEnter(Collider other)
    {
        if (other.CompareTag("S"))
        {
            if (!audioSource.isPlaying)
            {
                audioSource.Play();
            }
        }
    }

    // 使用物理碰撞（两个物体都有 Rigidbody 或至少一个有 Rigidbody）
    void OnCollisionEnter(Collision collision)
    {
        if (collision.gameObject.CompareTag("S"))
        {
            if (!audioSource.isPlaying)
            {
                audioSource.Play();
            }
        }
    }
}
*/

//动画播放
using UnityEngine;

[RequireComponent(typeof(AudioSource))]
public class hitTOmusic : MonoBehaviour
{
    private AudioSource audioSource;

    [Tooltip("游戏开始后多少秒内忽略所有碰撞（防止鼓棒初始位置重叠误触发）")]
    public float startupIgnoreTime = 0.5f;

    [Tooltip("两次触发之间的最小间隔（秒），防止同一次碰撞重复响")]
    public float cooldown = 0.1f;

    // 记录上次播放时间：初始值为正无穷，确保游戏开始前绝对不会触发
    float _lastPlayTime = float.NegativeInfinity;
    bool  _ready        = false;   // Start() 跑完后才允许触发

    void Start()
    {
        audioSource  = GetComponent<AudioSource>();
        // 启动保护：从当前时间往后推 startupIgnoreTime 秒才允许发声
        _lastPlayTime = Time.time + startupIgnoreTime;
        _ready        = true;
    }

    void OnTriggerEnter(Collider other)
    {
        if (other.CompareTag("S")) TryPlaySound();
    }

    void OnCollisionEnter(Collision collision)
    {
        if (collision.gameObject.CompareTag("S")) TryPlaySound();
    }

    void TryPlaySound()
    {
        if (!_ready) return;                                    // Start() 还没跑完
        if (Time.time - _lastPlayTime < cooldown) return;      // 冷却中
        _lastPlayTime = Time.time;
        audioSource.PlayOneShot(audioSource.clip);
    }
}