FROM node:18.13.0

# 解决问题：https://github.com/mastodon/mastodon/issues/802
RUN npm config set unsafe-perm true

RUN npm i -g pm2@latest --no-optional

RUN npm i -g pnpm@9.1.0

# docker中使用的路径
ENV CODE_PUSH_SERVER=/app

# 在docker中创建一个路径
RUN mkdir -p $CODE_PUSH_SERVER
RUN mkdir -p /app/cache

# 当前目录中的内容copy到CODE_PUSH_SERVER下
COPY ../../ $CODE_PUSH_SERVER

# 设置工作目录
WORKDIR $CODE_PUSH_SERVER

RUN pwd && ls -l $CODE_PUSH_SERVER

RUN pnpm install --store /app/cache

RUN pnpm run build

# 安装以及构建
# RUN yarn install && yarn build

# workaround for issue https://github.com/Unitech/pm2/issues/4950
CMD ["sh", "-c", "pm2 ps && pm2-runtime /app/packages/code-push-server/process.json"]
