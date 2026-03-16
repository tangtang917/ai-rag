package com.ls.dev.trigger.http.dto;

/**
 * 长文本流式场景下的“预提交请求体”。
 *
 * 使用背景：
 * 前端如果直接把很长的 message 拼进 GET 查询参数，
 * 很容易碰到 URL 长度限制，所以这里先通过 POST 把完整内容提交到后端。
 *
 * 字段说明：
 * model   - 本次对话要使用的模型名称，例如 deepseek-r1:1.5b
 * message - 用户输入的完整问题内容
 */
public record StreamPrepareRequest(String model, String message) {
}
