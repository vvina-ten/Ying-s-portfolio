using UnityEngine;
using UnityEditor;
using System.IO;

public class FixBranchAlpha
{
    [MenuItem("Tools/Fix Branch Alpha Mode")]
    static void Fix()
    {
        int count = 0;
        foreach (string guid in AssetDatabase.FindAssets("t:Material", new[] { "Assets/ALP_Assets" }))
        {
            string   path    = AssetDatabase.GUIDToAssetPath(guid);
            Material mat     = AssetDatabase.LoadAssetAtPath<Material>(path);
            if (mat == null) continue;

            string matName = Path.GetFileNameWithoutExtension(path).ToLower();
            if (!matName.Contains("branch")) continue;

            // 关闭 Alpha Clipping，改回不透明渲染
            if (mat.HasProperty("_AlphaClip"))
            {
                mat.SetFloat("_AlphaClip", 0f);
                mat.DisableKeyword("_ALPHATEST_ON");
            }

            // Surface Type = Opaque (0)
            if (mat.HasProperty("_Surface"))
                mat.SetFloat("_Surface", 0f);

            // Render Queue 改回不透明
            mat.renderQueue = (int)UnityEngine.Rendering.RenderQueue.Geometry;

            EditorUtility.SetDirty(mat);
            count++;
        }
        AssetDatabase.SaveAssets();
        Debug.Log($"完成！修复 {count} 个 branch 材质。");
    }
}
