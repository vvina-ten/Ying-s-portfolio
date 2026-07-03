using UnityEngine;
using UnityEditor;
using System.Collections.Generic;
using System.IO;

/// <summary>
/// 修复 NatureStarterKit2 内嵌材质（特别针对树叶/灌木）
/// 菜单：Tools → Fix Nature Leaf Materials
/// </summary>
public class NatureKitMaterialFixer : EditorWindow
{
    private string targetFolder = "Assets/NatureStarterKit2";
    private Vector2 scrollPos;
    private List<string> log = new List<string>();

    [MenuItem("Tools/Fix Nature Leaf Materials")]
    public static void ShowWindow()
    {
        var window = GetWindow<NatureKitMaterialFixer>("树叶材质修复");
        window.minSize = new Vector2(500, 450);
    }

    private void OnGUI()
    {
        GUILayout.Space(8);
        EditorGUILayout.LabelField("🍃 树叶/灌木材质修复工具 (URP)", EditorStyles.boldLabel);
        EditorGUILayout.LabelField("专门修复 Prefab 内嵌的 Nature/Tree Leaves Shader", EditorStyles.miniLabel);
        GUILayout.Space(8);
        targetFolder = EditorGUILayout.TextField("目标文件夹", targetFolder);
        GUILayout.Space(8);
        EditorGUILayout.HelpBox(
            "本工具使用 PrefabUtility.LoadPrefabContents 安全加载并修改 Prefab 内嵌材质\n" +
            "• 树叶 → URP/Lit + AlphaClip + 双面渲染\n" +
            "• 树皮/灌木 → URP/Lit + 单面\n" +
            "• 同时修复独立 .mat 文件", MessageType.Info);
        GUILayout.Space(8);
        GUI.backgroundColor = new Color(0.3f, 0.85f, 0.4f);
        if (GUILayout.Button("▶  开始修复所有材质", GUILayout.Height(38)))
        {
            log.Clear();
            DoFix();
            Repaint();
        }
        GUI.backgroundColor = Color.white;
        GUILayout.Space(6);
        EditorGUILayout.LabelField("日志：", EditorStyles.boldLabel);
        scrollPos = EditorGUILayout.BeginScrollView(scrollPos, GUILayout.ExpandHeight(true));
        foreach (var line in log)
        {
            Color c = GUI.color;
            if (line.StartsWith("✅")) GUI.color = new Color(0.4f, 1f, 0.5f);
            else if (line.StartsWith("❌")) GUI.color = new Color(1f, 0.4f, 0.4f);
            else if (line.StartsWith("⚠")) GUI.color = new Color(1f, 0.9f, 0.3f);
            else if (line.StartsWith("──")) GUI.color = new Color(0.6f, 0.8f, 1f);
            EditorGUILayout.LabelField(line, EditorStyles.wordWrappedLabel);
            GUI.color = c;
        }
        EditorGUILayout.EndScrollView();
    }

    // ─────────────────────────────────────────────────────────────────────────
    private void DoFix()
    {
        Shader urpLit = Shader.Find("Universal Render Pipeline/Lit");
        if (urpLit == null)
        {
            log.Add("❌ 未找到 URP/Lit Shader，请确认项目已安装 URP！");
            return;
        }

        int totalMat = 0, okMat = 0;

        // ── 1. 修复独立 .mat 文件 ────────────────────────────────────────────
        log.Add("── 独立材质文件 (.mat) ──");
        string[] matGuids = AssetDatabase.FindAssets("t:Material", new[] { targetFolder });
        var standaloneFixed = new List<string>();
        foreach (string g in matGuids)
        {
            string p = AssetDatabase.GUIDToAssetPath(g);
            Material m = AssetDatabase.LoadAssetAtPath<Material>(p);
            if (m == null) continue;
            if (m.shader == null || m.shader.name.StartsWith("Universal Render Pipeline")) continue;
            totalMat++;
            ApplyURPLit(m, urpLit, IsLeafMaterial(m.name, p));
            EditorUtility.SetDirty(m);
            okMat++;
            standaloneFixed.Add(Path.GetFileName(p));
        }
        if (standaloneFixed.Count > 0)
            log.Add($"✅ 独立材质已修复 {standaloneFixed.Count} 个：{string.Join(", ", standaloneFixed)}");
        else
            log.Add("ℹ 无需修复的独立材质（已是 URP）");

        // ── 2. 修复 Prefab 内嵌材质（用 LoadPrefabContents）────────────────
        log.Add("── Prefab 内嵌材质 ──");
        string[] prefabGuids = AssetDatabase.FindAssets("t:Prefab", new[] { targetFolder });
        foreach (string g in prefabGuids)
        {
            string prefabPath = AssetDatabase.GUIDToAssetPath(g);
            string prefabName = Path.GetFileNameWithoutExtension(prefabPath);
            bool prefabChanged = false;

            // 安全加载 prefab 内容
            GameObject root = null;
            try { root = PrefabUtility.LoadPrefabContents(prefabPath); }
            catch (System.Exception e)
            {
                log.Add($"❌ 无法加载 {prefabName}: {e.Message}");
                continue;
            }

            // 遍历所有 Renderer 里的材质
            Renderer[] renderers = root.GetComponentsInChildren<Renderer>(true);
            foreach (Renderer rend in renderers)
            {
                // sharedMaterials 返回实例，直接修改
                Material[] mats = rend.sharedMaterials;
                for (int i = 0; i < mats.Length; i++)
                {
                    Material mat = mats[i];
                    if (mat == null) continue;
                    if (mat.shader == null || mat.shader.name.StartsWith("Universal Render Pipeline")) continue;

                    bool isLeaf = IsLeafMaterial(mat.name, prefabPath);
                    log.Add($"  → [{prefabName}] {mat.name} ({mat.shader.name}) isLeaf={isLeaf}");

                    ApplyURPLit(mat, urpLit, isLeaf);
                    totalMat++;
                    okMat++;
                    prefabChanged = true;
                }
            }

            if (prefabChanged)
            {
                try
                {
                    PrefabUtility.SaveAsPrefabAsset(root, prefabPath);
                    log.Add($"✅ {prefabName} 已保存");
                }
                catch (System.Exception e)
                {
                    log.Add($"❌ {prefabName} 保存失败: {e.Message}");
                }
            }

            PrefabUtility.UnloadPrefabContents(root);
        }

        AssetDatabase.SaveAssets();
        AssetDatabase.Refresh();
        log.Add($"── 完成！共修复 {okMat}/{totalMat} 个材质 ──");
    }

    // ─────────────────────────────────────────────────────────────────────────
    /// <summary>将材质切换为 URP/Lit，并重映射贴图</summary>
    private void ApplyURPLit(Material mat, Shader urpLit, bool isLeaf)
    {
        // 读取旧贴图（换 Shader 前读取，否则属性失效）
        Texture mainTex  = SafeGetTex(mat, "_MainTex");
        Texture bumpMap  = SafeGetTex(mat, "_BumpMap");
        Texture occMap   = SafeGetTex(mat, "_OcclusionMap");
        Color   col      = mat.HasProperty("_Color") ? mat.GetColor("_Color") : Color.white;
        float   cutoff   = mat.HasProperty("_Cutoff") ? mat.GetFloat("_Cutoff") : 0.4f;

        // 切换 Shader
        mat.shader = urpLit;

        // 重映射贴图
        if (mainTex != null) mat.SetTexture("_BaseMap", mainTex);
        if (bumpMap  != null) mat.SetTexture("_BumpMap", bumpMap);
        if (occMap   != null) mat.SetTexture("_OcclusionMap", occMap);
        mat.SetColor("_BaseColor", col);

        if (isLeaf)
        {
            // 树叶：Alpha Clip + 双面渲染
            mat.SetFloat("_Surface",    0);           // Opaque
            mat.SetFloat("_AlphaClip",  1);           // 开启 Alpha 裁剪
            mat.SetFloat("_Cutoff",     Mathf.Clamp(cutoff, 0.2f, 0.6f));
            mat.SetFloat("_Cull",       0);           // CullOff = 双面
            mat.EnableKeyword("_ALPHATEST_ON");
            mat.DisableKeyword("_ALPHABLEND_ON");
            mat.DisableKeyword("_ALPHAPREMULTIPLY_ON");
            mat.renderQueue = 2450;
        }
        else
        {
            // 树皮/灌木：普通不透明
            mat.SetFloat("_Surface",   0);
            mat.SetFloat("_AlphaClip", 0);
            mat.SetFloat("_Cull",      2);            // CullBack = 正常单面
            mat.renderQueue = 2000;
        }
    }

    private static bool IsLeafMaterial(string matName, string path)
    {
        string lower = (matName + path).ToLower();
        return lower.Contains("leaf") || lower.Contains("leaves") ||
               lower.Contains("branch") || lower.Contains("foliage") ||
               lower.Contains("bush") || lower.Contains("frond");
    }

    private static Texture SafeGetTex(Material mat, string prop)
    {
        try { return mat.HasProperty(prop) ? mat.GetTexture(prop) : null; }
        catch { return null; }
    }
}
