/**
 * TaskClassifier — 按任务类型分级漏出 (req_leak_by_task_class + decision_leak_by_task_class).
 *
 * 用户判定「对话/文本创作/构思架构方案」与「执行命令」是两件完全不同的事：
 *   - 对话/创作/构思 → 需要灵气 → 强漏 (drift + situational + recall)
 *   - 执行命令       → 需要严谨 → 零漏 (仅 recall，不注入潜意识)
 *   - 一般询问       → 轻漏 (drift + recall)
 *
 * 分类由任务性质判定，不靠用户手动开关，也非「问句强度」(之前的实现误用问号强度，
 * 导致执行命令被最大漏出，踩 rule_mechanism_first 的禁编造红线)。v1 用启发式；#25 的
 * LlmGrader 实现同一接口、可返回 Promise。
 */

import type { TaskAssessment, TaskClass, LeakLevel } from "../types.js";

export interface TaskClassifier {
  assess(userText: string): TaskAssessment | Promise<TaskAssessment>;
}

const EXECUTE = [
  "运行", "执行", "启动", "安装", "部署", "编译", "构建", "重启", "停止", "杀掉", "kill",
  "命令", "脚本", "shell", "bash", "终端", "命令行", "跑一下", "跑这个", "执行这个",
  "改代码", "写代码", "改文件", "创建文件", "删除文件", "建表", "迁移", "部署到",
  "build", "make", "compile", "run", "execute", "command", "npm", "pip", "git", "docker",
  "kill ", "rm -", "rmdir", "mkdir", "chmod", "sudo", "systemctl", "cron",
];

const CREATIVE = [
  "写", "创作", "故事", "小说", "诗", "文案", "随笔", "构思", "设计", "方案", "脑洞",
  "聊聊", "闲聊", "吐槽", "你觉得", "怎么看", "想象", "角色", "设定", "世界观", "脚本(创作)",
  "write", "story", "poem", "design", "brainstorm", "imagine", "chat",
];

/** 把任务类映射到漏出强度。 */
function leakOf(task: TaskClass): LeakLevel {
  if (task === "execute") return "none";
  if (task === "creative") return "strong";
  return "weak";
}

export class Grader implements TaskClassifier {
  assess(userText: string): TaskAssessment {
    const t = userText.toLowerCase();
    const exec = EXECUTE.some((k) => t.includes(k.toLowerCase()));
    const crea = CREATIVE.some((k) => t.includes(k.toLowerCase()));
    // 问号：偏向「询问」，除非命中执行/创作关键词则让关键词优先。
    const isQuestion = t.includes("?") || t.includes("？");

    let task: TaskClass;
    let confidence: number;
    let reason: string;
    if (exec) {
      task = "execute";
      confidence = 0.8;
      reason = "命中执行/命令类关键词 → 需要严谨，零漏";
    } else if (crea) {
      task = "creative";
      confidence = 0.7;
      reason = "命中创作/对话/构思类关键词 → 需要灵气，强漏";
    } else if (isQuestion) {
      task = "neutral";
      confidence = 0.5;
      reason = "一般询问（含问号、非执行非创作）→ 轻漏";
    } else {
      task = "neutral";
      confidence = 0.4;
      reason = "默认一般任务 → 轻漏";
    }
    return { taskClass: task, leakLevel: leakOf(task), confidence, reason: `heuristic ${reason}` };
  }
}
