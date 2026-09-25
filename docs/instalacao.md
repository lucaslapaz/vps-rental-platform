# Instalação do zero

Este guia vai de um Windows sem nada instalado até a Favo criando VPS de verdade. Siga as partes na ordem: cada uma
depende da anterior. Se algo não sair como descrito, veja [problemas-comuns.md](problemas-comuns.md), que também explica o
que dá para mudar (senhas, nomes, rede) sem quebrar o projeto.

Combinação testada: Windows 11, VirtualBox 7.2.12, Proxmox VE 9.2.2, Node 24.12, MySQL 8.4 e um Intel i3-10100F com 8 GB
de RAM.

| Parte | O que você faz | Onde |
|---|---|---|
| [A](#parte-a--windows-e-virtualbox) | Libera a virtualização no Windows e cria a VM do Proxmox | Windows (PowerShell) |
| [B](#parte-b--proxmox) | Instala o Proxmox, cria a rede das VPS e instala a sua chave SSH | Janela da VM, depois Git Bash |
| [C](#parte-c--projeto-no-windows) | Clona o projeto e prepara o MySQL | Git Bash e MySQL |
| [D](#parte-d--proxmox-para-a-favo) | Cria o token da plataforma, baixa as imagens e constrói os templates | Git Bash (scripts do repositório) |
| [E](#parte-e--rodar-e-conferir) | Cria as tabelas, sobe a aplicação e cria a primeira VPS | Git Bash e navegador |

## Como tudo fica no final

```
Windows (192.168.56.1 na rede host-only)
 ├─ MySQL 8.4 ............ 127.0.0.1:3306, bancos vps_platform_{dev,test,prod,shadow}
 ├─ Favo (npm run dev) ... http://localhost:3000
 └─ VirtualBox
     └─ VM do Proxmox (2 vCPU, 3 GB de RAM, disco de 30 GB, VT-x aninhado)
         ├─ Adaptador 1: NAT ........ nic0 → vmbr0  10.0.2.15      saída para a internet
         └─ Adaptador 2: Host-only .. nic1 → vmbr1  192.168.56.10  Windows ↔ Proxmox ↔ VPS
              ├─ templates 9000–9003 (Alpine, Debian 13, Ubuntu 24.04, Alpine com XFCE)
              └─ VPS a partir do VMID 2000, IPs 192.168.56.200–.228
```

Endereços reservados na rede host-only: `.1` Windows · `.10` Proxmox · `.101–.199` DHCP do VirtualBox · `.200–.228` VPS ·
`.229` testes de laboratório · `.250` build dos templates.

> **Reinstalando por cima de uma instalação anterior?** Três coisas sobram no Windows e atrapalham:
> 1. **A chave de host do Proxmox antigo** no `~/.ssh/known_hosts`. O SSH recusa a conexão com *"REMOTE HOST
>    IDENTIFICATION HAS CHANGED"*. O passo [B4](#b4-chave-ssh-do-windows-no-root-do-proxmox) já inclui a limpeza.
> 2. **Os bancos do MySQL**, com VPS que apontam para VMs que não existem mais. Recrie os bancos no passo
>    [C3](#c3-mysql-bancos-e-usuário).
> 3. **A VM antiga no VirtualBox:** apague-a em *Máquina → Remover → Apagar todos os arquivos* antes de criar a nova.

---

## Parte A — Windows e VirtualBox

### A1. O que o PC precisa ter

- Processador com virtualização ligada na BIOS/UEFI: VT-x (Intel) ou AMD-V (AMD). Só foi testado com Intel.
- **8 GB de RAM** no mínimo. A VM do Proxmox usa 3 GB.
- **~35 GB livres** para o disco da VM.
- Windows 10 ou 11, 64 bits.

### A2. Deixar o VT-x livre para o VirtualBox (Hyper-V desligado)

As VPS são VMs **dentro** da VM do Proxmox. Isso se chama virtualização aninhada. Para funcionar, o VirtualBox precisa
usar o VT-x do processador diretamente. Quando o **Hyper-V** está ativo, o Windows toma o VT-x para si e o VirtualBox
passa a rodar sobre ele, no modo "NEM", mais lento, que aparece com um ícone de tartaruga. Nesse modo, a virtualização
aninhada não funciona, e nenhuma VPS liga.

O Hyper-V pode ser ligado por: o próprio recurso Hyper-V, o **WSL2**, o **Docker Desktop**, a "Plataforma de Máquina
Virtual", o Windows Sandbox e a **Integridade de Memória** (*Segurança do Windows → Segurança do dispositivo →
Isolamento de núcleo*).

Para conferir, abra o PowerShell:

```powershell
(Get-CimInstance Win32_ComputerSystem).HypervisorPresent    # precisa ser False
```

Se aparecer `True`, desligue o hipervisor do Windows sem desinstalar nada. Rode no **PowerShell como administrador** e
reinicie o PC em seguida:

```powershell
bcdedit /set hypervisorlaunchtype off     # laboratório (VirtualBox com VT-x)
# bcdedit /set hypervisorlaunchtype auto  # para voltar a usar o WSL2 ou o Docker Desktop depois
```

Desligue também a Integridade de Memória, se estiver ligada. Depois de reiniciar, o `HypervisorPresent` precisa voltar
como `False`.

### A3. VirtualBox e a rede host-only

1. Instale o VirtualBox 7.2 (testado na 7.2.12).
2. Confira a rede **host-only**. Ela é uma rede privada entre o Windows e as VMs, e é por ela que a Favo fala com o
   Proxmox e que você acessa as VPS. Em *Arquivo → Ferramentas → Gerenciador de Rede → Redes Host-only* precisa existir um
   adaptador com IPv4 **`192.168.56.1`** e máscara **`255.255.255.0`**. O VirtualBox cria um assim na instalação, chamado
   `VirtualBox Host-Only Ethernet Adapter`. Pelo PowerShell:

   ```powershell
   $vb = "C:\Program Files\Oracle\VirtualBox\VBoxManage.exe"
   & $vb list hostonlyifs      # procure IPAddress: 192.168.56.1
   & $vb list dhcpservers      # veja o DHCP dessa rede
   ```

3. **O DHCP da host-only não pode distribuir os IPs de `.200` em diante**, porque eles são das VPS e do build dos
   templates. Se existir um servidor DHCP para essa rede, limite a faixa até `.199`:

   ```powershell
   & $vb dhcpserver modify --network="HostInterfaceNetworking-VirtualBox Host-Only Ethernet Adapter" --upper-ip=192.168.56.199
   ```

   Se não houver DHCP nessa rede, não há nada a fazer.

### A4. Criar a VM do Proxmox

Baixe a ISO do **Proxmox VE 9** em <https://www.proxmox.com/en/downloads>. O teste foi com a 9.2.

**Os dois adaptadores de rede são a parte mais importante desta VM:**

| Adaptador | Modo | Vira, dentro do Proxmox | Serve para | Se estiver errado |
|---|---|---|---|---|
| **1** | **NAT** | `nic0` → `vmbr0` (10.0.2.15) | Internet do Proxmox e das VPS (download das imagens, `apt`/`apk` dentro das VPS) | Sem internet: o download das imagens e o build dos templates falham, e as VPS ficam sem internet |
| **2** | **Placa de rede exclusiva de hospedeiro** (Host-only), `VirtualBox Host-Only Ethernet Adapter`, com **Modo Promíscuo = Permitir Tudo** | `nic1` → `vmbr1` (192.168.56.10) | Windows ↔ Proxmox (interface web, API, SSH) e Windows ↔ VPS | Sem ele, a Favo não alcança o Proxmox. **Sem o modo promíscuo**, o Proxmox responde, mas as VPS não: a placa só aceita os pacotes do MAC do próprio Proxmox e descarta os das VPS |

- **A ordem importa.** O Adaptador 1 vira a `nic0`, e é nela que o instalador do Proxmox configura a rede de
  gerência com internet. Se trocar a ordem, os nomes se invertem.
- O tipo de placa testado é o padrão, *Intel PRO/1000 MT Desktop (82540EM)*.
- O modo **"Placa em modo Bridge" do VirtualBox não é usado**. A bridge das VPS é uma bridge Linux criada dentro do
  Proxmox, no passo B2.

Crie a VM de um dos dois jeitos.

**Jeito 1: tudo pelo PowerShell (testado).** Ajuste `$vm` e `$iso`:

```powershell
$vb  = "C:\Program Files\Oracle\VirtualBox\VBoxManage.exe"
$vm  = "Proxmox"                                               # nome da VM (qualquer um)
$iso = "$env:USERPROFILE\Downloads\proxmox-ve_9.2-1.iso"       # caminho da ISO baixada

& $vb createvm --name $vm --ostype Debian_64 --register
$dir  = Split-Path ((& $vb showvminfo $vm --machinereadable | Select-String '^CfgFile="(.*)"').Matches[0].Groups[1].Value.Replace('\\', '\'))
$disk = Join-Path $dir "$vm.vdi"
& $vb createmedium disk --filename $disk --size 30720 --format VDI
& $vb storagectl $vm --name SATA --add sata --controller IntelAhci
& $vb storageattach $vm --storagectl SATA --port 0 --device 0 --type hdd --medium $disk
& $vb storagectl $vm --name IDE --add ide --controller PIIX4
& $vb storageattach $vm --storagectl IDE --port 1 --device 0 --type dvddrive --medium $iso
& $vb modifyvm $vm --cpus=2 --memory=3072 --firmware=bios --graphicscontroller=vmsvga --vram=16 `
  --boot1=disk --boot2=dvd --boot3=none --boot4=none --nested-hw-virt=on `
  --nic1=nat --nic-type1=82540EM `
  --nic2=hostonly --host-only-adapter2="VirtualBox Host-Only Ethernet Adapter" --nic-type2=82540EM --nic-promisc2=allow-all
```

A ordem de boot põe o disco primeiro. Enquanto ele está vazio, a VM inicia pela ISO. Depois da instalação, inicia pelo
disco, mesmo com a ISO ainda no drive.

**Jeito 2: pela interface do VirtualBox.** Em *Novo*, escolha Tipo *Linux* e Versão *Debian (64-bit)*. Se escolher a
ISO no assistente, marque **"Pular instalação desassistida"**: o VirtualBox não sabe instalar o Proxmox sozinho. Use
3072 MB de memória, 2 CPUs, EFI **desmarcado** e um disco VDI de **30 GB**. Depois, em *Configurações*:

- *Rede → Adaptador 1*: habilitado, **NAT**.
- *Rede → Adaptador 2*: habilitado, **Placa de rede exclusiva de hospedeiro**, nome `VirtualBox Host-Only Ethernet
  Adapter`, *Avançado → Modo Promíscuo: **Permitir Tudo***.
- *Sistema → Processador → "Habilitar VT-x/AMD-V Aninhado"*: **essa caixa costuma ficar acinzentada e não dá para
  marcar**. Isso é normal. Com a VM desligada, ligue pelo PowerShell (o comando grava a opção na configuração da VM):

  ```powershell
  & "C:\Program Files\Oracle\VirtualBox\VBoxManage.exe" modifyvm "Proxmox" --nested-hw-virt=on
  ```

**3 GB de RAM, e não mais:** com 8 GB no PC, o Windows fica com pouca memória livre com o Proxmox ligado. Com 3 GB, o
Proxmox usa ~1,4 GB, e sobram ~1,5 GB para as VPS. É para isso que a capacidade da Favo está calibrada
(`CAPACITY_MAX_MEMORY_MB=1536`). Se você der mais RAM ao Proxmox, pode aumentar esse valor.

### A5. Conferir o VT-x aninhado

Ligue a VM com uma janela: `& $vb startvm $vm`. Com ela ligada, procure no log:

```powershell
Select-String -Path "$env:USERPROFILE\VirtualBox VMs\$vm\Logs\VBox.log" -Pattern 'NestedHWVirt|UseNEMInstead|HMR3Init|fall back to NEM'
```

| Tem que aparecer | Se aparecer isto, algo está errado |
|---|---|
| `NestedHWVirt ... (1)` | `NestedHWVirt ... (0)`: o aninhado está desligado. Desligue a VM e rode o `--nested-hw-virt=on` |
| `UseNEMInstead ... (0)` e `HM: HMR3Init: VT-x w/ nested paging…` | `Attempting fall back to NEM` ou `UseNEMInstead (1)`: o Hyper-V está ativo. Volte ao A2 |

---

## Parte B — Proxmox

### B1. Instalar

Na janela da VM, escolha **Install Proxmox VE (Graphical)** e preencha:

| Tela | O que escolher | Por quê |
|---|---|---|
| Target Harddisk | O disco de 30 GB, com o filesystem **ext4** (o padrão) | O ext4 cria o storage **`local-lvm`** (LVM thin), onde ficam as VPS e os clones vinculados. ZFS ou Btrfs criariam outro storage (ver problemas-comuns) |
| País, fuso e teclado | Os seus | O teclado vale para o console da VM, usado no B2 |
| Senha do root e e-mail | Os que quiser | A senha só é usada no login da interface web e **uma vez**, para instalar a chave SSH (B4). O projeto não a guarda |
| Management Interface | **`nic0`** (ou a primeira placa da lista) | É o Adaptador 1 (NAT), a única rede com internet. Confira: o MAC mostrado é o do Adaptador 1 nas configurações da VM |
| Hostname (FQDN) | Um nome com domínio, ex.: `pve.laboratorio.local` | A primeira parte (`pve`) vira o **nome do nó**. Qualquer nome serve: os scripts o descobrem sozinhos |
| IP / Gateway / DNS | `10.0.2.15/24` / `10.0.2.2` / o que o instalador sugerir | São os valores do NAT do VirtualBox |

No fim, deixe reiniciar. A VM inicia pelo disco. Se quiser, tire a ISO do drive em *Dispositivos → Discos Ópticos*.

### B2. Rede das VPS (`vmbr1`), pelo console da VM

Logo depois da instalação, o Windows ainda **não alcança** o Proxmox: o único IP dele é o do NAT. Este passo é feito na
**janela da VM**. Entre como `root`, com a senha escolhida.

1. Confira os nomes das placas: `ip -br link`. Devem aparecer `nic0` e `nic1`. Compare o MAC da `nic1` com o do
   Adaptador 2 do VirtualBox.
2. Faça uma cópia do arquivo de rede e abra o editor:

   ```bash
   cp /etc/network/interfaces /root/interfaces.orig
   nano /etc/network/interfaces
   ```

3. O instalador já escreveu a `vmbr0`, sobre a `nic0`, e a linha `iface nic1 inet manual`. Se essa linha não existir,
   acrescente-a. **Acrescente no fim do arquivo**, sem aspas, como está abaixo. O `scripts/pve/firewall.sh` procura
   a linha do `MASQUERADE` depois:

   ```
   auto vmbr1
   iface vmbr1 inet static
   	address 192.168.56.10/24
   	bridge-ports nic1
   	bridge-stp off
   	bridge-fd 0
   	post-up   echo 1 > /proc/sys/net/ipv4/ip_forward
   	post-up   iptables -t nat -A POSTROUTING -s 192.168.56.0/24 -o vmbr0 -j MASQUERADE
   	post-down iptables -t nat -D POSTROUTING -s 192.168.56.0/24 -o vmbr0 -j MASQUERADE
   ```

   O que cada parte faz:
   - A `vmbr1` é um "switch virtual" ligado à `nic1`, a host-only. As VPS se conectam a ele e ficam na mesma rede do
     Windows.
   - O `192.168.56.10` passa a ser o endereço do Proxmox nessa rede.
   - O `ip_forward` e o `MASQUERADE` fazem as VPS saírem para a internet pela `vmbr0`, o NAT.

4. Salve com `Ctrl+O`, `Enter` e `Ctrl+X`. Aplique com `ifreload -a` e confira: `ip -br addr show vmbr1` deve mostrar
   `192.168.56.10/24`.
5. No Windows: `ping 192.168.56.10` deve responder, e **https://192.168.56.10:8006** deve abrir a interface web, depois
   do aviso de certificado. Entre com `root`, realm *Linux PAM*.

Daqui em diante, a janela da VM não é mais necessária. Para ligar o Proxmox sem janela no dia a dia:
`& $vb startvm $vm --type headless`. Para desligar de forma limpa: `& $vb controlvm $vm acpipowerbutton`.

### B3. Repositórios de atualização (opcional)

O Proxmox vem configurado com os repositórios *enterprise*, que exigem assinatura, e por isso o `apt update` do nó dá
erro. **A Favo não precisa de `apt` no nó**, então este passo é opcional. Se quiser atualizar o Proxmox, vá na interface
web em *nó → Atualizações → Repositórios*: desabilite os dois repositórios *enterprise* (`pve-enterprise` e `ceph`) e
adicione o **No-Subscription**. Neste laboratório, isso foi feito com o script da comunidade *post-pve-install*
([community-scripts.org](https://community-scripts.org)), que também tira o aviso de assinatura.

### B4. Chave SSH do Windows no root do Proxmox

Os scripts do repositório entram no Proxmox por SSH **com chave, sem senha**. O teste dos templates e os testes `@lab`
entram nas VPS com a chave **`~/.ssh/id_ed25519`** do Windows. No **Git Bash**:

```bash
ssh-keygen -R 192.168.56.10                                      # apaga a chave de host de um Proxmox antigo (se houver)
[ -f ~/.ssh/id_ed25519 ] || ssh-keygen -t ed25519 -N "" -f ~/.ssh/id_ed25519
cat ~/.ssh/id_ed25519.pub | ssh root@192.168.56.10 'cat >> /root/.ssh/authorized_keys'
```

O último comando pergunta se você confia no servidor (responda `yes`) e pede a senha do root, só desta vez. Para
conferir que o acesso por chave funciona e que o KVM está disponível dentro do Proxmox:

```bash
ssh -o BatchMode=yes root@192.168.56.10 'pveversion; ls /dev/kvm; grep -c vmx /proc/cpuinfo'
```

Deve imprimir a versão, `/dev/kvm` e um número maior que zero. Se o `/dev/kvm` não existir, o VT-x aninhado não
chegou ao Proxmox: volte ao A5.

A chave é gerada sem senha (`-N ""`) porque os scripts rodam sem interação. Uma chave com senha só funciona com um
`ssh-agent` carregado.

---

## Parte C — Projeto no Windows

### C1. Programas

| Programa | Versão | Observação |
|---|---|---|
| Git for Windows | qualquer recente | Traz o **Git Bash**, onde rodam os scripts `.sh` |
| Node.js | **24.12 ou maior** | `node --version` |
| MySQL Server | **8.4** | Instalado como serviço (o padrão chama `MySQL84`) na porta 3306. Guarde a senha do root do MySQL |

### C2. Clonar e instalar

```bash
git clone https://github.com/lucaslapaz/vps-rental-platform.git
cd vps-rental-platform
npm install          # também gera o Prisma Client
```

Use `git clone`, não o ZIP do GitHub: o `.gitattributes` garante que os `.sh` tenham quebra de linha LF, e com CRLF o
bash do Proxmox não roda os scripts.

### C3. MySQL: bancos e usuário

A aplicação usa quatro bancos e um usuário próprio, `vps_app`, que só tem acesso a eles. Abra o cliente do MySQL como
root no **PowerShell**. No Git Bash, o pedido de senha do `mysql.exe` pode travar. O MySQL Workbench também serve:

```powershell
& "C:\Program Files\MySQL\MySQL Server 8.4\bin\mysql.exe" -uroot -p
```

Rode o SQL abaixo, trocando `TROQUE_ESTA_SENHA` pela senha que você quer para o `vps_app`. Prefira letras e números: a
senha vai dentro de uma URL. O script do próximo passo codifica caracteres especiais, mas uma senha simples evita
surpresas.

```sql
CREATE DATABASE IF NOT EXISTS vps_platform_dev    CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE DATABASE IF NOT EXISTS vps_platform_test   CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE DATABASE IF NOT EXISTS vps_platform_prod   CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE DATABASE IF NOT EXISTS vps_platform_shadow CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE USER IF NOT EXISTS 'vps_app'@'localhost' IDENTIFIED BY 'TROQUE_ESTA_SENHA';
CREATE USER IF NOT EXISTS 'vps_app'@'127.0.0.1' IDENTIFIED BY 'TROQUE_ESTA_SENHA';
GRANT ALL PRIVILEGES ON vps_platform_dev.*    TO 'vps_app'@'localhost', 'vps_app'@'127.0.0.1';
GRANT ALL PRIVILEGES ON vps_platform_test.*   TO 'vps_app'@'localhost', 'vps_app'@'127.0.0.1';
GRANT ALL PRIVILEGES ON vps_platform_prod.*   TO 'vps_app'@'localhost', 'vps_app'@'127.0.0.1';
GRANT ALL PRIVILEGES ON vps_platform_shadow.* TO 'vps_app'@'localhost', 'vps_app'@'127.0.0.1';
```

- **O usuário `vps_app` já existia e você não lembra a senha?** Troque-a:
  `ALTER USER 'vps_app'@'localhost' IDENTIFIED BY '…'; ALTER USER 'vps_app'@'127.0.0.1' IDENTIFIED BY '…';`
- **Os bancos são de uma instalação anterior?** Eles guardam VPS de um Proxmox que não existe mais, e os usuários de
  demonstração com a senha antiga. Para começar limpo, **apague-os** com o comando abaixo e rode o SQL acima de novo.
  Isso apaga todos os dados da Favo nesses bancos:
  `DROP DATABASE vps_platform_dev; DROP DATABASE vps_platform_test; DROP DATABASE vps_platform_prod; DROP DATABASE vps_platform_shadow;`

### C4. Arquivos de configuração (`.env.*`)

A aplicação lê `.env.development` (`npm run dev`), `.env.test` (testes) e `.env.production` (`npm start`). Eles ficam
**fora do git**. Não copie o [.env.example](../.env.example) à mão. Rode o comando abaixo, que cria os arquivos com
segredos aleatórios. Ele pergunta a senha do `vps_app` do passo C3, nunca troca um valor que já existe e só acrescenta o
que falta:

```bash
npm run env:setup                    # .env.development e .env.test
npm run env:setup -- --production    # opcional: também o .env.production (com o admin inicial)
```

Ele avisa que ainda faltam as variáveis do Proxmox (`PVE_*`). Elas vêm no passo D1.

O que é cada variável, o formato de cada segredo e como gerar um valor novo para uma variável específica
(`npm run env:secret -- <VARIÁVEL>`) estão em [variaveis-de-ambiente.md](variaveis-de-ambiente.md).

| Variável | De onde vem | Para que serve |
|---|---|---|
| `DATABASE_URL`, `SHADOW_DATABASE_URL` | `npm run env:setup` (C4) | Conexão com o MySQL. O shadow é usado pelo `prisma migrate dev` |
| `SEED_DEFAULT_PASSWORD` | `npm run env:setup` (C4), aleatória | **Senha dos usuários de demonstração** (`ana@favo.local` e os outros) |
| `CSRF_SECRET`, `JOB_SECRET_KEY` | `npm run env:setup` (C4), aleatórias | Assinatura do token CSRF e cifra das senhas nos jobs |
| `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` | `npm run env:setup -- --production` | Admin inicial do banco de produção |
| `PVE_URL`, `PVE_NODE`, `PVE_TLS_SERVERNAME`, `PVE_CA_FILE`, `PVE_TOKEN_ID`, `PVE_TOKEN_SECRET` | `scripts/pve/bootstrap.sh` (D1) | Acesso ao Proxmox com o token da plataforma (um *API Token* do Proxmox, criado pelo próprio Proxmox) |

---

## Parte D — Proxmox para a Favo

Tudo aqui roda no **Git Bash**, na raiz do repositório. Os scripts entram no Proxmox por SSH (B4) e são idempotentes:
rodar de novo não estraga nada. Todos aceitam `PVE_HOST=<ip>` se o Proxmox não estiver em `192.168.56.10`.

### D1. Identidade da plataforma (token)

```bash
scripts/pve/bootstrap.sh
npm run env:setup                  # copia as PVE_* para o .env.test (e o .env.production); não pergunta a senha de novo
```

O `bootstrap.sh` cria no Proxmox:
- os pools `vps-platform` (VPS) e `vps-templates`;
- a role `VPSPlatformVM`;
- o usuário `vpsplatform@pve` e o token `vpsplatform@pve!backend`;
- as permissões, restritas a esses pools. A plataforma **nunca** usa o root.

Ele também copia a CA do Proxmox para `certs/pve-root-ca.pem` e grava as `PVE_*` no `.env.development`. O nome do nó é
descoberto sozinho.

> O *secret* do token só aparece quando o token é criado. Se você apagou o `.env.development` mas o Proxmox continua o
> mesmo, o script avisa. Rode `scripts/pve/bootstrap.sh --rotate-token` para gerar outro.

### D2. Imagens cloud oficiais

```bash
scripts/pve/download-images.sh
```

O script baixa para `/var/lib/vz/import/` no Proxmox as imagens oficiais do Alpine 3.24, do Debian 13 e do Ubuntu 24.04
minimal, com ~800 MB no total. Ele confere cada uma com o checksum publicado pela distribuição e só guarda o arquivo se
o checksum bater.

### D3. Templates (golden images)

```bash
scripts/pve/build-template.sh all
```

O script constrói os quatro templates, 9000 a 9003. Para cada imagem:
- cria uma VM temporária com o IP `.250`;
- atualiza o sistema;
- instala o `qemu-guest-agent` e, na versão Desktop, o XFCE;
- limpa a identidade da VM;
- converte a VM em template.

**Leva vários minutos por imagem**, e a Desktop é a mais demorada. Depois de cada template, o script roda sozinho o teste
de aceite (`scripts/pve/test-template.mjs`), **com o token da plataforma**, não com o root:
- cria um clone com o IP `.229`;
- confere ping, SSH com a sua chave, DNS, `sudo`/`doas`, disco, guest agent, senha root e console;
- apaga o clone;
- confere que o token **não** consegue apagar o template.

Também dá para construir um template de cada vez: `scripts/pve/build-template.sh alpine`, `debian`, `ubuntu` ou
`alpine-desktop`. Se tiver pouco tempo, comece pelo `alpine`: é o mais leve e o suficiente para testar.

### D4. Firewall anti-spoofing

```bash
scripts/pve/firewall.sh
```

O script liga o firewall do Proxmox, que por padrão aceita todo o tráfego do nó, só para permitir o anti-spoofing: cada
VPS só consegue usar o próprio IP e MAC. Ele também grava na `vmbr1` a regra de *conntrack zone* que mantém o NAT das VPS
funcionando com o firewall ligado. Antes de ligar, agenda um *rollback* automático de 3 minutos, e só o cancela depois
de confirmar que o SSH e a porta 8006 continuam acessíveis.

---

## Parte E — Rodar e conferir

```bash
npm run db:setup:dev                                   # cria as tabelas e o seed (planos, imagens, IPs e usuários) no banco de dev
npx cross-env NODE_ENV=test prisma migrate deploy      # cria as tabelas no banco de teste (os testes fazem o seed sozinhos)
npm run pve -- status                                  # o servidor enxerga o Proxmox com o token?
npm run pve -- capacity                                # RAM e disco disponíveis para VPS
npm run dev                                            # http://localhost:3000
```

Aguarde no log a linha `worker de jobs iniciado`. Depois, no navegador:

1. Entre com **`ana@favo.local`**. A senha está em `SEED_DEFAULT_PASSWORD`, no `.env.development`. Os outros usuários
   são `bruno@` (cliente), `carla@` e `diego@` (suporte) e `admin@`, todos `@favo.local` e com a mesma senha.
2. **Criar VPS**: imagem Alpine, plano Nano, uma senha ou a sua chave SSH (`cat ~/.ssh/id_ed25519.pub`).
3. No pagamento, use o cartão de teste **`4242 4242 4242 4242`** (aprovado), com qualquer validade futura e qualquer CVV.
   Os cartões `4000 0000 0000 0002` (recusado) e `4000 0000 0000 9995` (saldo insuficiente) testam os erros.
4. A linha do tempo mostra a criação ao vivo, e em ~30–40 s a VPS fica **Ligada**. Teste o **Console** no navegador e o
   SSH pelo Windows: `ssh <usuário>@192.168.56.200`.

### Outros comandos

| Comando | O que faz |
|---|---|
| `npm test` | Unidade e integração, com o Proxmox falso e o banco de teste. Não precisa do laboratório ligado |
| `npx playwright install chromium` e depois `npm run test:e2e` | Testes E2E no navegador. A instalação do Chromium só é necessária uma vez |
| `npm run test:lab` | Roteiro completo contra o Proxmox real. Usa o IP `.229` e precisa de RAM livre no Proxmox |
| `npm run db:migrate:deploy`, `npm run db:seed:prod`, `npm run build` e `npm start` | "Produção" local, com o `.env.production` e o banco `vps_platform_prod` |
| `npm run pve -- list` | VMs do pool da plataforma e a VPS dona de cada uma |

Não rode `npm test` e `npm run test:e2e` ao mesmo tempo: os dois usam o mesmo banco de teste.

Deu algo errado? Veja [problemas-comuns.md](problemas-comuns.md).
