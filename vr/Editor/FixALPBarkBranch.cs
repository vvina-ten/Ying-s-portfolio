using UnityEngine;
using UnityEditor;
using System.IO;
using System.Collections.Generic;

public class FixALPBarkBranch
{
    [MenuItem("Tools/Fix ALP Bark & Branch Textures")]
    static void Fix()
    {
        // 材质基础名（小写，去掉 _urp）→ 对应贴图基础名
        var albedoMap = new Dictionary<string, string>
        {
            { "bark",     "diffuse01" },
            { "bark02",   "diffuse02" },
            { "bark03 1", "diffuse03_1" },
            { "bark03",   "diffuse03" },
            { "bark04",   "diffuse04" },
            { "bark05",   "diffuse05" },
            { "bark06",   "diffuse06" },
            { "bark07",   "diffuse07" },

            { "branch",     "diffuse01" },
            { "branch02",   "diffuse02" },
            { "branch03 1", "diffuse03_1" },
            { "branch03",   "diffuse03" },
            { "branch04",   "diffuse04" },
            { "branch05",   "diffuse05" },
            { "branch06",   "diffuse06" },
            { "branch07",   "diffuse07" },
            { "branch08",   "diffuse08" },

            { "diffuseflowergrass01", "diffuse_flowergrass01" },
        };

        // 建贴图名（小写）→ 路径索引
        var texIndex = new Dictionary<string, string>();
        foreach (string g in AssetDatabase.FindAssets("t:Texture2D", new[] { "Assets/ALP_Assets" }))
        {
            string p = AssetDatabase.GUIDToAssetPath(g);
            string n = Path.GetFileNameWithoutExtension(p).ToLower();
            if (!texIndex.ContainsKey(n)) texIndex[n] = p;
        }

        int count = 0;
        foreach (string guid in AssetDatabase.FindAssets("t:Material", new[] { "Assets/ALP_Assets" }))
        {
            string   path    = AssetDatabase.GUIDToAssetPath(guid);
            Material mat     = AssetDatabase.LoadAssetAtPath<Material>(path);
            if (mat == null) continue;

            // 已经有 BaseMap 的跳过
            if (mat.HasProperty("_BaseMap") && mat.GetTexture("_BaseMap") != null) continue;

            string matBase = Path.GetFileNameWithoutExtension(path)
                                 .ToLower()
                                 .Replace("_urp", "")
                                 .TrimEnd('_');

            if (!albedoMap.TryGetValue(matBase, out string texBase)) continue;

            bool changed = false;

            // Albedo
            if (texIndex.TryGetValue(texBase, out string albedoPath))
            {
                var tex = AssetDatabase.LoadAssetAtPath<Texture2D>(albedoPath);
                if (tex != null) { mat.SetTexture("_BaseMap", tex); changed = true; }
            }

            // Normal（texBase + _n）
            if (texIndex.TryGetValue(texBase + "_n", out string normPath))
            {
                var tex = AssetDatabase.LoadAssetAtPath<Texture2D>(normPath);
                if (tex != null)
                {
                    mat.SetTexture("_BumpMap", tex);
                    mat.EnableKeyword("_NORMALMAP");
                    changed = true;
                }
            }

            // Branch 材质启用 Alpha Clipping（叶片镂空）
            if (matBase.StartsWith("branch") && mat.HasProperty("_AlphaClip"))
            {
                mat.SetFloat("_AlphaClip", 1f);
                mat.EnableKeyword("_ALPHATEST_ON");
                changed = true;
            }

            if (changed)
            {
                EditorUtility.SetDirty(mat);
                Debug.Log($"已修复: {matBase} → {texBase}");
                count++;
            }
        }

        AssetDatabase.SaveAssets();
        Debug.Log($"完成！共修复 {count} 个材质。");
    }
}
