using UnityEngine;
using UnityEditor;
using System.IO;
using System.Collections.Generic;

public class ReconnectALPTextures
{
    [MenuItem("Tools/Reconnect ALP Textures")]
    static void Reconnect()
    {
        // 找到所有 ALP 材质
        string[] matGuids = AssetDatabase.FindAssets("t:Material", new[] { "Assets/ALP_Assets" });

        // 找到所有贴图，建立名字 → 路径的索引（小写方便匹配）
        string[] texGuids = AssetDatabase.FindAssets("t:Texture2D", new[] { "Assets/ALP_Assets" });
        var texMap = new Dictionary<string, string>();
        foreach (string g in texGuids)
        {
            string p    = AssetDatabase.GUIDToAssetPath(g);
            string name = Path.GetFileNameWithoutExtension(p).ToLower();
            if (!texMap.ContainsKey(name))
                texMap[name] = p;
        }

        int count = 0;
        foreach (string guid in matGuids)
        {
            string   path = AssetDatabase.GUIDToAssetPath(guid);
            Material mat  = AssetDatabase.LoadAssetAtPath<Material>(path);
            if (mat == null) continue;

            // 材质基础名：去掉 _urp / _URP 后缀
            string baseName = Path.GetFileNameWithoutExtension(path)
                                  .ToLower()
                                  .Replace("_urp", "")
                                  .TrimEnd('_');

            bool changed = false;

            // ── Base Map (Albedo) ──
            changed |= TryAssign(mat, texMap, baseName, "_BaseMap",
                "_albedo", "_color", "_diffuse", "_basecolor", "_col", "_bc", "");

            // ── Normal Map ──
            if (TryAssign(mat, texMap, baseName, "_BumpMap",
                "_normal", "_nrm", "_norm", "_n"))
            {
                mat.EnableKeyword("_NORMALMAP");
                changed = true;
            }

            // ── Metallic / Smoothness ──
            changed |= TryAssign(mat, texMap, baseName, "_MetallicGlossMap",
                "_metallic", "_metallicsmoothness", "_metalsmooth", "_metal_smooth",
                "_ms", "_metallicgloss");

            // ── AO ──
            if (TryAssign(mat, texMap, baseName, "_OcclusionMap",
                "_ao", "_ambientocclusion", "_occlusion"))
            {
                mat.EnableKeyword("_OCCLUSIONMAP");
                changed = true;
            }

            // ── Emission ──
            changed |= TryAssign(mat, texMap, baseName, "_EmissionMap",
                "_emission", "_emissive", "_emit");

            // 勾上 Alpha Clipping（树叶需要）
            if (mat.HasProperty("_AlphaClip"))
            {
                mat.SetFloat("_AlphaClip", 1f);
                mat.EnableKeyword("_ALPHATEST_ON");
                changed = true;
            }

            if (changed)
            {
                EditorUtility.SetDirty(mat);
                count++;
                Debug.Log($"已重连: {path}");
            }
        }

        AssetDatabase.SaveAssets();
        Debug.Log($"完成！共处理 {count} 个材质。");
    }

    // 按候选后缀依次尝试匹配贴图，匹配到就赋值并返回 true
    static bool TryAssign(Material mat, Dictionary<string, string> texMap,
                           string baseName, string shaderProp, params string[] suffixes)
    {
        if (!mat.HasProperty(shaderProp)) return false;

        foreach (string suffix in suffixes)
        {
            string key = baseName + suffix;
            if (texMap.TryGetValue(key, out string texPath))
            {
                Texture2D tex = AssetDatabase.LoadAssetAtPath<Texture2D>(texPath);
                if (tex != null)
                {
                    mat.SetTexture(shaderProp, tex);
                    return true;
                }
            }
        }
        return false;
    }
}
