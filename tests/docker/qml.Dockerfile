FROM archlinux:latest@sha256:3c64b538588416593f69a1aebd2f2ec0f2541b29159f32556fa7def2167147a0

ARG ARCHIVE_DATE=2026/10/12

RUN echo "Server = https://archive.archlinux.org/repos/${ARCHIVE_DATE}/\$repo/os/\$arch" > /etc/pacman.d/mirrorlist \
    && pacman -Syyuu --noconfirm --needed \
        qt6-declarative \
        kirigami \
        libplasma \
        plasma5support \
        kcmutils \
        plasma-workspace \
        libsecret \
        kwallet \
        gnome-keyring \
        curl \
        openssl \
        python \
    && pacman -Scc --noconfirm

RUN useradd --create-home --uid 10001 tester \
    && install -d -o tester -g tester /results /work

COPY --chown=tester:tester package /work/package
COPY --chown=tester:tester tests /work/tests

USER tester
WORKDIR /work

ENV QT_QPA_PLATFORM=offscreen

CMD ["bash", "tests/qml/run.sh"]
