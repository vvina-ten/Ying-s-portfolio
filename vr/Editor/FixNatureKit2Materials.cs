using UnityEngine;
using UnityEditor;
using System.IO;

public class FixNatureKit2Materials
{
    [MenuItem("Tools/Fix NatureStarterKit2 Materials (URP)")]
    static void Fix()
    {
        Shader urpLit = Shader.Find("Universal Render Pipeline/Lit");
        if (urpLit == null) { Debug.LogError("找不到 URP/Lit shader！"); return; }

        int count = 0;
        foreach (string guid in AssetDatabase.FindAssets("t:Material", new[] { "Assets/NatureStarterKit2" }))
        {
            string   path = AssetDatabase.GUIDToAssetPath(guid);
            Material mat  = AssetDatabase.LoadAssetAtPath<Material>(path);
            if (mat == null) continue;
            if (mat.shader == urpLit) continue;

            // 先保存旧贴图
            Texture mainTex   = mat.HasProperty("_MainTex")   ? mat.GetTexture("_MainTex")   : null;
            Texture bumpMap   = mat.HasProperty("_BumpMap")   ? mat.GetTexture("_BumpMap")   : null;
            Color   mainColor = mat.HasProperty("_Color")     ? mat.GetColor("_Color")        : Color.white;
            float   cutoff    = mat.HasProperty("_Cutoff")    ? mat.GetFloat("_Cutoff")       : 0.5f;
            bool    hasAlpha  = mat.renderQueue >= 2450 || mat.IsKeywordEnabled("_ALPHATEST_ON");

            mat.shader = urpLit;

            if (mainTex != null) mat.SetTexture("_BaseMap", mainTex);
            mat.SetColor("_BaseColor", mainColor);
            if (bumpMap != null)
            {
                mat.SetTexture("_BumpMap", bumpMap);
                mat.EnableKeyword("_NORMALMAP");
            }

            // 叶片/草 需要 Alpha Clipping
            if (hasAlpha)
            {
                mat.SetFloat("_AlphaClip", 1f);
                mat.EnableKeyword("_ALPHATEST_ON");
                mat.SetFloat("_Cutoff", cutoff);
                mat.renderQueue = 2450;
            }

            EditorUtility.SetDirty(mat);
            count++;
            Debug.Log($"已转换: {Path.GetFileNameWithoutExtension(path)}");
        }

        AssetDatabase.SaveAssets();
        Debug.Log($"完成！共转换 {count} 个材质。");
    }
}
