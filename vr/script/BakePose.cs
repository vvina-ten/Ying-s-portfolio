using UnityEngine;
using UnityEditor;

public class BakePose
{
    [MenuItem("Tools/Bake Current Pose To New Prefab")]
    static void Bake()
    {
        GameObject selected = Selection.activeGameObject;
        if (selected == null) { Debug.LogError("请先选中对象"); return; }

        // 深度复制
        GameObject copy = Object.Instantiate(selected);
        copy.name = selected.name + "_BakedPose";

        // 把复制体的所有骨骼 Transform 强制同步自原对象
        Transform[] srcBones = selected.GetComponentsInChildren<Transform>();
        Transform[] dstBones = copy.GetComponentsInChildren<Transform>();

        for (int i = 0; i < srcBones.Length && i < dstBones.Length; i++)
        {
            dstBones[i].localPosition = srcBones[i].localPosition;
            dstBones[i].localRotation = srcBones[i].localRotation;
            dstBones[i].localScale    = srcBones[i].localScale;
        }

        // 删掉 Animator，防止它重置姿势
        Animator anim = copy.GetComponent<Animator>();
        if (anim != null) Object.DestroyImmediate(anim);

        // 保存成 Prefab
        string path = "Assets/BakedPose_" + copy.name + ".prefab";
        PrefabUtility.SaveAsPrefabAsset(copy, path);
        Object.DestroyImmediate(copy);

        Debug.Log("已保存：" + path);
    }
}
