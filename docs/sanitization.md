# 脱敏检查清单

发布前建议运行：

```bash
find . -maxdepth 3 -type f | sort
rg -n "sk-|gho_|access_token|zsxq_access_token|Cookie|Authorization|api_key|oops\\.asia" .
git status --short
```

期望结果：

- Git 提交中没有 `data/`
- Git 提交中没有 `.cache/`
- 没有 HAR 抓包文件
- 没有私有生成 Skill
- 没有真实 API Key 或访问 Token
- 没有前端 build 产物或依赖目录

