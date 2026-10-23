import { describe, expect, it } from "vitest";
import {
  buildQuestionnaireRequest,
  normalizeWenjuanxingUrl,
} from "./wenjuanxing";

describe("Wenjuanxing request", () => {
  it.each([
    "https://v.wjx.cn/vm/abc.aspx",
    "https://www.wjx.top/vj/abc.aspx",
    "https://www.wjx.com/jq/123.aspx",
    "http://wjx.cn/m/123.aspx?source=abc#section",
  ])("accepts survey URL %s", (url) => {
    expect(normalizeWenjuanxingUrl(` ${url} `)).toBe(url);
  });
  it.each([
    "https://wjx.cn.evil.com/vm/x",
    "https://evilwjx.cn/vm/x",
    "https://wjx.cn@evil.com/vm/x",
    "https://user:pass@wjx.cn/vm/x",
    "javascript:alert(1)",
    "file:///etc/passwd",
    "https://localhost/x",
    "https://wjx.cn:8080/vm/x",
    "https://wjx.cn",
    "not a url",
  ])("rejects invalid URL %s", (url) => {
    expect(() => normalizeWenjuanxingUrl(url)).toThrow();
  });
  const base = {
    url: "https://v.wjx.cn/vm/abc.aspx",
    information: "姓名：张三",
    answers: [],
    submit: false,
  };
  it("requires information and complete, unambiguous answers", () => {
    expect(() =>
      buildQuestionnaireRequest({ ...base, information: " " }),
    ).toThrow("请提供");
    expect(() =>
      buildQuestionnaireRequest({
        ...base,
        answers: [{ question: "姓名", answer: " " }],
      }),
    ).toThrow("补全");
    expect(() =>
      buildQuestionnaireRequest({
        ...base,
        answers: [
          { question: "姓名", answer: "张三" },
          { question: " 姓名 ", answer: "李四" },
        ],
      }),
    ).toThrow("重复");
  });
  it("preserves supplied values as JSON and defaults to fill only", () => {
    const request = buildQuestionnaireRequest({
      ...base,
      answers: [{ question: " 爱好 ", answer: '阅读、运动\n"其他"' }],
    });
    expect(request.url).toBe(base.url);
    expect(request.proxy_location).toBe("NONE");
    expect(request.prompt).toContain("只填写，不提交");
    expect(request.prompt).not.toContain("允许最终提交");
    const payload = JSON.parse(request.prompt.split("\n").at(-1)!);
    expect(payload.answers).toEqual([
      { question: "爱好", answer: '阅读、运动\n"其他"' },
    ]);
  });
  it("supports answers alone and explicit submission", () => {
    const request = buildQuestionnaireRequest({
      ...base,
      information: "",
      answers: [{ question: "姓名", answer: "张三" }],
      submit: true,
    });
    expect(request.prompt).toContain("允许最终提交");
    expect(request.prompt).toContain("点击最终提交一次");
    expect(request.error_code_mapping).toHaveProperty("MISSING_INFORMATION");
  });
  it("bounds payload size", () => {
    expect(() =>
      buildQuestionnaireRequest({ ...base, information: "x".repeat(10001) }),
    ).toThrow("过长");
  });
});
