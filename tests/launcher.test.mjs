import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("Windows 启动脚本使用 CMD 可稳定解析的 CRLF 换行", () => {
  const bytes = readFileSync(new URL("../启动原型.bat", import.meta.url));
  const loneLfPositions = [];

  for (let index = 0; index < bytes.length; index += 1) {
    if (bytes[index] === 0x0a && bytes[index - 1] !== 0x0d) {
      loneLfPositions.push(index);
    }
  }

  assert.deepEqual(
    loneLfPositions,
    [],
    `发现 ${loneLfPositions.length} 个 LF-only 换行，cmd.exe 会错误拆分中文命令`,
  );
});
