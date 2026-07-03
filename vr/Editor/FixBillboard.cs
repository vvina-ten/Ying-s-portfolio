using UnityEngine;
using UnityEditor;
using System.IO;

public class FixBillboard
{
    [MenuItem("Tools/Fix ALP Billboard Materials")]
    static void Fix()
    {
        // 找 billboard 贴图
        string[] texGuids = AssetDatabase.FindAssets("billboards_ t:Texture2D", new[] { "Assets/ALP_Assets" });
        if (texGuids.Length == 0) { Debug.LogError("找不到 billboards_ 贴图！"); return; }
        string   texPath = AssetDatabase.GUIDToAssetPath(texGuids[0]);
        Texture2D billTex = AssetDatabase.LoadAssetAtPath<Texture2D>(texPath);

        Shader urpLit = Shader.Find("Universal Render Pipeline/Lit");
        int count = 0;

        foreach (string guid in AssetDatabase.FindAssets("t:Material", new[] { "Assets/ALP_Assets" }))
        {
            string   path = AssetDatabase.GUIDToAssetPath(guid);
            Material mat  = AssetDatabase.LoadAssetAtPath<Material>(path);
            if (mat == null) continue;

            string name = Path.GetFileNameWithoutExtension(path).ToLower();
            if (!name.Contains("billboard")) continue;

            mat.shader = urpLit;
            mat.SetTexture("_BaseMap", billTex);
            mat.SetFloat("_AlphaClip", 1f);
            mat.EnableKeyword("_ALPHATEST_ON");
            mat.renderQueue = 2450;
            EditorUtility.SetDirty(mat);
            count++;
            Debug.Log($"已修复 billboard 材质: {path}");
        }

        AssetDatabase.SaveAssets();
        Debug.Log($"完成！修复 {count} 个 billboard 材质。");
    }
}
