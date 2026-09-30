# 跑者工具箱 · run.bot100.store

合并了原来的三个站点：

| 旧站 | 旧仓库 | 新位置 |
|---|---|---|
| pace.bot100.store | running-pace-calculator | `#tools/pace` 配速、`#tools/predict` 成绩预测、`#plan` 13 周计划 |
| heartrate.bot100.store | daniels-heart-rate-calculator | `#tools/hr` 心率区间 |
| runlog.bot100.store | running-monitoring | `#log` 训练日志，首页 `#today` 汇总 |

旧的 `#pace`、`#hr` 链接会自动跳到新位置。

纯静态页面，无构建步骤、无第三方依赖。

- `calc.js`：纯计算（配速、Riegel 预测、丹尼尔斯心率区间、周汇总、ACWR、提醒规则、13 周计划数据、旧版导入格式转换），网页和之后的 Skill 共用同一套口径
- `icons.js`：用到的 Phosphor 图标路径
- `app.js`：界面逻辑，数据存浏览器 localStorage（键 `run.bot100.v1`）
- 导出格式：`{ app, version, exportedAt, profile, records, planDone }`；旧版 runlog 导出的数组格式也能导入

本地预览：

```bash
python3 -m http.server 7660
```
