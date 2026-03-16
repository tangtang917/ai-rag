/**
 * trigger 模块负责对外暴露 HTTP 能力。
 *
 * 当前这个包下面主要包含两类职责：
 * 1. http：控制器、请求 DTO、响应 DTO，直接面向前端或调用方
 * 2. service：为控制器提供会话暂存等辅助能力
 *
 * 这层的定位可以理解为“流量入口层”：
 * - 接收浏览器或其他客户端传入的参数
 * - 做基础校验
 * - 组织调用 Spring AI / Ollama
 * - 把结果以普通 JSON 或 SSE 的形式返回给前端
 */
package com.ls.dev.trigger;
