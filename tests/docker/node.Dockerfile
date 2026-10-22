FROM node:24-alpine@sha256:44fce696f38ba8c987c4db89954051000bbd05ffd8d8659ba15ed4a8602e937f

RUN apk add --no-cache bash coreutils findutils grep sed shellcheck \
    && adduser -D -u 10001 tester \
    && install -d -o tester -g tester /results /work

COPY --chown=tester:tester package.json /work/package.json
COPY --chown=tester:tester package /work/package
COPY --chown=tester:tester tests /work/tests

USER tester
WORKDIR /work

CMD ["bash", "tests/node-checks.sh"]
