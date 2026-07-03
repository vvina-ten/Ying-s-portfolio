using UnityEngine;
using UnityEditor;
using System.IO;
using System.Collections.Generic;

public class DiagnoseALPMaterials
{
    [MenuItem("Tools/List All ALP Textures")]
    static void ListAll()
    {
        string[] texGuids = AssetDatabase.FindAssets("t:Texture2D", new[] { "Assets/ALP_Assets" });
        var names = new List<string>();
        foreach (string g in texGuids)
        {
            string p = AssetDatabase.GUIDToAssetPath(g);
            names.Add(Path.GetFileNameWithoutExtension(p));
        }
        names.Sort();
        Debug.Log("=== 全部贴图名 ===\n" + string.Join("\n", names));
    }

    [MenuItem("Tools/Diagnose ALP Missing Textures")]
    static void Diagnose()
    {
        string[] matGuids = AssetDatabase.FindAssets("t:Material", new[] { "Assets/ALP_Assets" });
        string[] texGuids = AssetDatabase.FindAssets("t:Texture2D", new[] { "Assets/ALP_Assets" });

        // 收集所有贴图名
        var allTexNames = new List<string>();
        var texMap      = new Dictionary<string, string>();
        foreach (string g in texGuids)
        {
            string p    = AssetDatabase.GUIDToAssetPath(g);
            string name = Path.GetFileNameWithoutExtension(p).ToLower();
            allTexNames.Add(name);
            if (!texMap.ContainsKey(name)) texMap[name] = p;
        }

        Debug.Log($"=== 找到 {allTexNames.Count} 张贴图，{matGuids.Length} 个材质 ===");

        var missing = new List<string>();
        foreach (string guid in matGuids)
        {
            string   path = AssetDatabase.GUIDToAssetPath(guid);
            Material mat  = AssetDatabase.LoadAssetAtPath<Material>(path);
            if (mat == null) continue;

            Texture baseMap = mat.HasProperty("_BaseMap") ? mat.GetTexture("_BaseMap") : null;
            if (baseMap == null)
            {
                string matName = Path.GetFileNameWithoutExtension(path).ToLower().Replace("_urp","").TrimEnd('_');
                missing.Add($"材质无BaseMap: {matName}");

                // 找出名字里含有 matName 片段的贴图供参考
                var candidates = allTexNames.FindAll(t => t.Contains(matName) || matName.Contains(t.Split('_')[0]));
                if (candidates.Count > 0)
                    missing.Add($"  候选贴图: {string.Join(", ", candidates)}");
                else
                    missing.Add($"  候选贴图: 无匹配");
            }
        }

        if (missing.Count == 0)
            Debug.Log("所有材质均已有 Base Map！");
        else
            foreach (string line in missing)
                Debug.Log(line);
    }
}
