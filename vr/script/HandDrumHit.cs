using UnityEngine;
using UnityEngine.InputSystem;

/// <summary>
/// 挂在左手模型上
/// 按下 Trigger 瞬间触发一次鼓声，松开后恢复，可再次触发
/// </summary>
public class HandDrumHit : MonoBehaviour
{
    public InputActionReference triggerAction;

    void OnEnable()  { triggerAction?.action.Enable();  }
    void OnDisable() { triggerAction?.action.Disable(); }

    void Update()
    {
        if (triggerAction != null && triggerAction.action.WasPressedThisFrame())
            DrumAudioManager.Instance?.PlayHeavy();
    }
}
