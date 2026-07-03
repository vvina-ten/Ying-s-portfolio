using UnityEngine;
using UnityEditor;

public class FixBrokenMaterials
{
    [MenuItem("Tools/Fix Broken URP Materials (InternalErrorShader)")]
    static void Fix()
    {
        string[] guids = AssetDatabase.FindAssets("t:Material", new[] { "Assets/ALP_Assets" });
        Shader urpLit  = Shader.Find("Universal Render Pipeline/Lit");

        if (urpLit == null)
        {
            Debug.LogError("找不到 URP/Lit Shader，请确认 URP 已安装！");
            return;
        }

        int count = 0;
        foreach (string guid in guids)
        {
            string path = AssetDatabase.GUIDToAssetPath(guid);
            Material mat = AssetDatabase.LoadAssetAtPath<Material>(path);
            if (mat == null) continue;

            if (mat.shader == null || mat.shader.name.Contains("InternalError") || mat.shader.name.Contains("Hidden"))
            {
                mat.shader = urpLit;
                EditorUtility.SetDirty(mat);
                count++;
                Debug.Log($"已修复: {path}");
            }
        }

        AssetDatabase.SaveAssets();
        Debug.Log($"完成！共修复 {count} 个材质。");
    }
}
