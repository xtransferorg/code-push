#!/bin/bash
source /etc/profile
#运维透传变量是否为生产
is_prod=$1

nvm install v18.20.4
nvm use v18.20.4
npm i -g pnpm@9.1.0
pnpm i

git status

if [ "$is_prod" == "false" ]; then
    pnpm run publish:beta
else
    pnpm run publish:prod
fi

