using UnityEngine;
using UnityEngine.InputSystem;
using System.Collections.Generic;


/// <summary>
/// 左手中指 Grip + Tag=D → 切换抓鼓手模型
/// 抓鼓期间食指 Trigger：
///   未按  → grabHandPrefab（默认抓鼓姿势）
///   按下  → pressHandPrefab（敲/扣姿势）
/// restHandPrefab 可选，按下前显示"食指搭按键"姿势；不填则跳过。
/// </summary>
public class LeftHandDrumGrab : MonoBehaviour
{
    [Header("── 输入 ──")]
    public InputActionReference gripAction;
    public InputActionReference triggerAction;

    [Header("── 手模型 ──")]
    [Tooltip("场景里正常的手 GameObject")]
    public GameObject normalHandModel;

    [Tooltip("抓鼓姿势 Prefab（中指握住）")]
    public GameObject grabHandPrefab;

    [Tooltip("Trigger 按下时的手姿势 Prefab（敲）")]
    public GameObject pressHandPrefab;

    [Tooltip("可选：食指搭在按键上但未按时的姿势。留空则直接在 grab 和 press 之间切。")]
    public GameObject restHandPrefab;

    [Header("── Raycast ──")]
    public Transform rayOrigin;
    [Range(0.1f, 5f)] public float rayDistance = 2f;
    public string drumTag = "D";
    public string attachPointName = "AttachPoint";

    [Header("── 音效 ──")]
    [Tooltip("鼓上的 HeavyHitZone（和 DrumFaceHit 用同一个）")]
    public HeavyHitZone heavyZone;

    [Range(0.1f, 5f)]
    [Tooltip("Trigger 前多少秒内经过 HeavyHitZone 才算重击（与 DrumFaceHit.heavyTimeWindow 保持一致）")]
    public float heavyTimeWindow = 2f;

    [Header("── Trigger 音效（独立，不走 DrumAudioManager）──")]
    [Tooltip("专门给手指按 Trigger 用的 AudioSource（可挂在控制器或任意位置）")]
    public AudioSource triggerAudioSource;
    [Tooltip("手指叩击的音效 Clip")]
    public AudioClip   triggerClip;

    [Header("── 手柄震动 ──")]
    [Range(0f, 1f)]       public float triggerHapticAmplitude = 0.4f;
    [Range(0.02f, 0.3f)]  public float triggerHapticDuration  = 0.08f;

    [Header("── 调试 ──")]
    public bool showDebugLog = true;

    // ── 私有状态 ──
    GameObject _grabInst;
    GameObject _restInst;
    GameObject _pressInst;
    int        _currentPose = -1;   // 0=grab  1=rest  2=press

    bool       _isGrabbing   = false;
    bool       _triggerHeld  = false;

    Rigidbody  _drumRb;             // 鼓的 Rigidbody（根物体）
    bool       _wasKinematic;       // 原始 isKinematic 状态，松手时还原
    Transform  _grabbedDrum;        // 鼓的根 Transform（Rigidbody 所在层）
    Transform  _drumAttachPoint;
    Vector3    _drumOriginalPos;
    Quaternion _drumOriginalRot;

    // =====================================================================
    // 生命周期
    // =====================================================================

    void OnEnable()
    {
        if (gripAction == null || gripAction.action == null)
        { Debug.LogWarning("[LHDGrab] gripAction 未赋值！"); return; }

        gripAction.action.performed += OnGripPerformed;
        gripAction.action.canceled  += OnGripCanceled;
        gripAction.action.Enable();

        if (triggerAction != null)
        {
            triggerAction.action.performed += OnTriggerPerformed;
            triggerAction.action.canceled  += OnTriggerCanceled;
            triggerAction.action.Enable();
        }
    }

    void OnDisable()
    {
        if (gripAction?.action != null)
        {
            gripAction.action.performed -= OnGripPerformed;
            gripAction.action.canceled  -= OnGripCanceled;
        }
        if (triggerAction?.action != null)
        {
            triggerAction.action.performed -= OnTriggerPerformed;
            triggerAction.action.canceled  -= OnTriggerCanceled;
            triggerAction.action.Disable();
        }
        ReleaseGrab();
    }

    void Update()
    {
        if (!_isGrabbing) return;

        // 当前显示的手跟着控制器走
        GameObject active = ActiveInstance();
        if (active != null && rayOrigin != null)
        {
            active.transform.position = rayOrigin.position;
            active.transform.rotation = rayOrigin.rotation;
        }

        // 鼓跟手走（用 MovePosition，Rigidbody 才能正确触发碰撞/触发器）
        if (_grabbedDrum != null && _drumAttachPoint != null && rayOrigin != null)
        {
            Vector3 offset = rayOrigin.position - _drumAttachPoint.position;
            if (_drumRb != null)
                _drumRb.MovePosition(_drumRb.position + offset);
            else
                _grabbedDrum.position += offset;
        }
    }

    // =====================================================================
    // Grip 回调
    // =====================================================================

    void OnGripPerformed(InputAction.CallbackContext ctx)
    {
        if (_isGrabbing) return;

        Vector3 o = rayOrigin != null ? rayOrigin.position : transform.position;
        Vector3 d = rayOrigin != null ? rayOrigin.forward  : transform.forward;

        if (!Physics.Raycast(o, d, out RaycastHit hit, rayDistance,
                             Physics.DefaultRaycastLayers, QueryTriggerInteraction.Collide))
        { if (showDebugLog) Debug.Log("[LHDGrab] 未命中"); return; }

        if (!hit.collider.CompareTag(drumTag))
        { if (showDebugLog) Debug.Log($"[LHDGrab] Tag={hit.collider.tag} 跳过"); return; }

        Transform ap = null;
        if (!string.IsNullOrEmpty(attachPointName))
            ap = hit.collider.transform.Find(attachPointName)
              ?? hit.collider.transform.parent?.Find(attachPointName);

        if (showDebugLog) Debug.Log($"[LHDGrab] 命中 Tag=D '{hit.collider.name}'");
        StartGrab(hit.collider.transform, ap);
    }

    void OnGripCanceled(InputAction.CallbackContext ctx) => ReleaseGrab();

    // =====================================================================
    // Trigger 回调（事件驱动，不轮询，避免抖动）
    // =====================================================================

    void OnTriggerPerformed(InputAction.CallbackContext ctx)
    {
        _triggerHeld = true;
        if (_isGrabbing)
        {
            ApplyTriggerPose();
            PlayDrumSound();
        }
    }

    void PlayDrumSound()
    {
        // 直接播专属 clip，不走 DrumAudioManager
        if (triggerAudioSource != null && triggerClip != null)
        {
            triggerAudioSource.PlayOneShot(triggerClip);
            if (showDebugLog) Debug.Log("[LHDGrab] Trigger 音效");
        }
        else if (showDebugLog)
        {
            Debug.LogWarning("[LHDGrab] triggerAudioSource 或 triggerClip 未赋值！");
        }

        // 左手震动反馈
        SendHaptic(UnityEngine.XR.XRNode.LeftHand, triggerHapticAmplitude, triggerHapticDuration);
    }

    static void SendHaptic(UnityEngine.XR.XRNode node, float amplitude, float duration)
    {
        var devices = new List<UnityEngine.XR.InputDevice>();
        UnityEngine.XR.InputDevices.GetDevicesAtXRNode(node, devices);
        foreach (var d in devices)
            d.SendHapticImpulse(0, Mathf.Clamp01(amplitude), duration);
    }

    void OnTriggerCanceled(InputAction.CallbackContext ctx)
    {
        _triggerHeld = false;
        if (_isGrabbing) ApplyTriggerPose();
    }

    void ApplyTriggerPose()
    {
        // press > rest > grab 优先级；restHandPrefab 未赋值则跳过 pose 1
        int targetPose = _triggerHeld ? 2
                       : (restHandPrefab != null ? 1 : 0);

        if (targetPose == _currentPose) return;
        _currentPose = targetPose;
        ShowPose(targetPose);
        if (showDebugLog) Debug.Log($"[LHDGrab] Trigger={_triggerHeld} → pose {targetPose}");
    }

    // =====================================================================
    // 抓取 / 松手
    // =====================================================================

    void StartGrab(Transform drum, Transform ap)
    {
        // 找 Rigidbody 根物体（hit 可能命中子碰撞体）
        _drumRb = drum.GetComponentInParent<Rigidbody>();
        Transform drumRoot = _drumRb != null ? _drumRb.transform : drum;

        _isGrabbing      = true;
        _currentPose     = -1;
        _triggerHeld     = false;
        _grabbedDrum     = drumRoot;
        _drumAttachPoint = ap;
        _drumOriginalPos = drumRoot.position;
        _drumOriginalRot = drumRoot.rotation;

        // 设为 Kinematic：移动时 OnTriggerEnter 才能正常触发
        if (_drumRb != null)
        {
            _wasKinematic      = _drumRb.isKinematic;
            _drumRb.isKinematic = true;
        }

        if (normalHandModel != null) normalHandModel.SetActive(false);

        Ensure(ref _grabInst,  grabHandPrefab);
        Ensure(ref _restInst,  restHandPrefab);
        Ensure(ref _pressInst, pressHandPrefab);

        HideAll();
        _currentPose = 0;
        ShowPose(0);
    }

    void ReleaseGrab()
    {
        if (!_isGrabbing) return;
        _isGrabbing  = false;
        _triggerHeld = false;
        _currentPose = -1;

        if (_grabbedDrum != null)
        {
            _grabbedDrum.position = _drumOriginalPos;
            _grabbedDrum.rotation = _drumOriginalRot;
        }

        // 还原 Rigidbody 状态
        if (_drumRb != null)
        {
            _drumRb.isKinematic = _wasKinematic;
            _drumRb.linearVelocity        = Vector3.zero;
            _drumRb.angularVelocity = Vector3.zero;
        }
        _drumRb          = null;
        _grabbedDrum     = null;
        _drumAttachPoint = null;

        if (normalHandModel != null) normalHandModel.SetActive(true);
        HideAll();
        if (showDebugLog) Debug.Log("[LHDGrab] 松手 → 还原");
    }

    // =====================================================================
    // 辅助
    // =====================================================================

    void Ensure(ref GameObject inst, GameObject prefab)
    {
        if (prefab == null || inst != null) { inst?.SetActive(false); return; }
        inst = Instantiate(prefab);
        inst.SetActive(false);
    }

    void HideAll()
    {
        _grabInst?.SetActive(false);
        _restInst?.SetActive(false);
        _pressInst?.SetActive(false);
    }

    void ShowPose(int pose)
    {
        HideAll();
        GameObject t = pose == 2 ? (_pressInst ?? _restInst ?? _grabInst)
                     : pose == 1 ? (_restInst  ?? _grabInst)
                     : _grabInst;
        if (t == null) return;
        t.SetActive(true);
        if (rayOrigin != null)
        {
            t.transform.position = rayOrigin.position;
            t.transform.rotation = rayOrigin.rotation;
        }
    }

    GameObject ActiveInstance() =>
        _currentPose == 2 ? (_pressInst ?? _restInst ?? _grabInst)
      : _currentPose == 1 ? (_restInst  ?? _grabInst)
      : _grabInst;

    void OnDrawGizmosSelected()
    {
        Vector3 o = rayOrigin != null ? rayOrigin.position : transform.position;
        Vector3 d = rayOrigin != null ? rayOrigin.forward  : transform.forward;
        Gizmos.color = Color.cyan;
        Gizmos.DrawRay(o, d * rayDistance);
        Gizmos.DrawWireSphere(o + d * rayDistance, 0.03f);
    }
}
