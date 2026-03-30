FROM ubuntu:20.04

ENV DEBIAN_FRONTEND=noninteractive
ENV TZ=Etc/UTC

RUN apt-get update && apt-get install -y \
    build-essential \
    pkg-config \
    libssl-dev \
    libudev-dev \
    llvm \
    libclang-dev \
    protobuf-compiler \
    curl \
    wget \
    git \
    ca-certificates \
    gnupg \
    unzip \
    && rm -rf /var/lib/apt/lists/*

# Node.js 20.x (needed for anchor test / ts-mocha)
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && npm install -g yarn \
    && rm -rf /var/lib/apt/lists/*

ARG USERNAME=vscode
ARG USER_UID=1000
ARG USER_GID=$USER_UID

RUN groupadd --gid $USER_GID $USERNAME \
    && useradd --uid $USER_UID --gid $USER_GID -m $USERNAME \
    && apt-get update && apt-get install -y sudo \
    && echo "$USERNAME ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers.d/$USERNAME \
    && chmod 0440 /etc/sudoers.d/$USERNAME \
    && rm -rf /var/lib/apt/lists/*

USER $USERNAME
WORKDIR /home/$USERNAME

# Rust via rustup
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable
ENV PATH="/home/${USERNAME}/.cargo/bin:${PATH}"

# Solana CLI 1.18.26 (compatible with Anchor 0.31.x)
RUN sh -c "$(curl -sSfL https://release.anza.xyz/v1.18.26/install)" \
    && echo 'export PATH="/home/vscode/.local/share/solana/install/active_release/bin:$PATH"' >> ~/.bashrc
ENV PATH="/home/${USERNAME}/.local/share/solana/install/active_release/bin:${PATH}"

# Anchor via avm
RUN cargo install --git https://github.com/coral-xyz/anchor avm --force \
    && avm install 0.31.1 \
    && avm use 0.31.1

# Generate a throwaway keypair so solana-test-validator / anchor test work out of the box
RUN mkdir -p /home/$USERNAME/.config/solana \
    && solana-keygen new --no-bip39-passphrase -o /home/$USERNAME/.config/solana/id.json \
    && solana config set --url localhost

WORKDIR /workspace
