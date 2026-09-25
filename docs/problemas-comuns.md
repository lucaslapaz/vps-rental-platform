# Problemas comuns e o que dá para mudar

Este documento complementa o [guia de instalação](instalacao.md). Ele responde a duas perguntas:
- O meu ambiente é um pouco diferente do guia. Isso quebra a Favo?
- Algo não funciona. Onde está o problema?

## 1. O que você pode mudar sem quebrar nada

| Diferença | Funciona? | Detalhe |
|---|---|---|
| **Senha do root do Proxmox** diferente | ✅ | O projeto não usa nem guarda essa senha. Ela só serve para o login web e para instalar a chave SSH uma vez (instalação, B4). Trocar a senha depois também não afeta nada |
| **Hostname / nome do nó** (qualquer um) | ✅ | O `bootstrap.sh` descobre o nome sozinho e grava em `PVE_NODE` e `PVE_TLS_SERVERNAME`. Não renomeie o nó **depois** de instalado: renomear um nó do Proxmox é um procedimento à parte, e o `.env` ficaria com o nome antigo |
| **Nome da VM no VirtualBox** | ✅ | Só aparece nos seus comandos `VBoxManage` |
| **Senha do MySQL** (`vps_app`) | ✅ | Fica no `DATABASE_URL`. Troque a senha no MySQL e no `.env.*`, ou apague as linhas `DATABASE_URL` e `SHADOW_DATABASE_URL` e rode `npm run env:setup` de novo |
| **MySQL em outra porta** | ✅ | Responda `127.0.0.1:3307` (por exemplo) à pergunta *MySQL: endereço* do `npm run env:setup`, ou edite o `DATABASE_URL` |
| **Mais RAM para o Proxmox** | ✅ | Aumente `CAPACITY_MAX_MEMORY_MB` no `.env.*` (padrão 1536, calibrado para uma VM de 3 GB) |
| **Menos RAM** (2 GB) | ⚠️ | O Proxmox liga, mas quase não sobra memória para VPS. Reduza o `CAPACITY_MAX_MEMORY_MB`, senão a criação é aceita e a VM não cabe |
| **Disco maior que 30 GB** | ✅ | Pode aumentar o `CAPACITY_MAX_DISK_GB` (padrão 12) |
| **Opções de disco do instalador no padrão** (sem `maxroot`/`minfree`) | ✅ | Em discos < 48 GiB a raiz fica com metade do disco, e o `local-lvm` com bem menos (9,6 GiB num disco de 35 GB). Funciona: a Favo confere o espaço livre real antes de aceitar cada VPS. Só cabem menos VPS (instalação, B1) |
| **Tipo/versão da VM, nº de CPUs, ordem de boot** diferentes do guia | ✅ | O que importa está na tabela do A4 e é conferido no A5 |
| **Outro usuário/token da plataforma** no Proxmox | ✅, com edição | Os nomes são constantes no início do `scripts/pve/bootstrap.sh`. A aplicação só lê o `PVE_TOKEN_ID`/`PVE_TOKEN_SECRET` |
| **VMIDs das VPS** a partir de outro número | ✅ | `PVE_VMID_START` (padrão 2000). Os templates continuam em 9000–9003 (vêm do seed, `prisma/seed/catalog.ts`) |
| **DNS das VPS** | ✅ | `VPS_NAMESERVERS` (padrão `1.1.1.1 8.8.8.8`) |

## 2. O que quebra, o sintoma e a correção

### Virtualização (a causa mais comum)

| Situação | Sintoma | Correção |
|---|---|---|
| **Hyper-V ativo no Windows**: Hyper-V, WSL2, Docker Desktop, Windows Sandbox ou Integridade de Memória | O VirtualBox roda com o ícone de tartaruga, o Proxmox fica muito lento e **não tem `/dev/kvm`**. Toda VPS termina em **Erro** (no Proxmox: *"KVM virtualisation configured, but not available"*). No `VBox.log`: `Attempting fall back to NEM` | PowerShell como administrador: `bcdedit /set hypervisorlaunchtype off`, desligue a Integridade de Memória e reinicie o PC. Para voltar a usar o WSL2 ou o Docker: `bcdedit /set hypervisorlaunchtype auto` e reiniciar. **Os dois não funcionam ao mesmo tempo** (instalação, A2) |
| **VT-x aninhado desligado** na VM do Proxmox (a caixa *Habilitar VT-x/AMD-V Aninhado* fica acinzentada e não dá para marcar) | O mesmo sintoma: sem `/dev/kvm`, VPS em Erro. No `VBox.log`: `NestedHWVirt ... (0)`; no `showvminfo --machinereadable`: `nested-hw-virt="off"` | Com a VM **desligada**: `VBoxManage modifyvm "<nome da VM>" --nested-hw-virt=on`. A caixa acinzentada é normal, e o comando é o caminho normal, não um "hack" (instalação, A5) |
| VT-x desligado na **BIOS** do PC | O VirtualBox nem liga VMs de 64 bits, ou reclama de VT-x | Ligue "Intel Virtualization Technology" (ou "SVM", na AMD) na BIOS |

Como conferir as duas primeiras sem adivinhar: veja o A5 do guia de instalação (configuração da VM e `VBox.log`) e
rode `ssh root@192.168.56.10 'ls /dev/kvm; grep -c vmx /proc/cpuinfo'`.

### Adaptadores de rede do VirtualBox

| Situação | Sintoma | Correção |
|---|---|---|
| **Sem o modo promíscuo "Permitir Tudo"** no Adaptador 2 (`Promisc Policy: deny` no `showvminfo`) | O Windows acessa o Proxmox (web, SSH), mas **não as VPS**. No D3, o teste do template falha no ping/SSH a partir do Windows, embora o `agent/ping` passe. Na Favo, a criação fica ~2 minutos na etapa final e termina como Ligada, com o aviso *"a porta 22 não abriu em 120 s"* no log. `ssh`/`ping 192.168.56.200` não respondem. O console no navegador funciona, porque passa pelo Proxmox | Com a VM desligada: `VBoxManage modifyvm "<nome>" --nic-promisc2=allow-all` (ou *Rede → Adaptador 2 → Avançado → Modo Promíscuo: Permitir Tudo*). Instalação, A5 |
| **Windows sem o IP `192.168.56.1`** na placa host-only (acontece depois de reiniciar o PC em algumas máquinas) | Com a VM do Proxmox ligada, o `ping 192.168.56.10` não responde, a interface web não abre e a Favo diz que o Proxmox está indisponível. No PowerShell, a placa `VirtualBox Host-Only Ethernet Adapter` aparece sem IPv4 ou com `169.254.x.x` | Confira e grave o IP de novo, sem precisar de administrador (instalação, A3, item 4): `VBoxManage hostonlyif ipconfig "VirtualBox Host-Only Ethernet Adapter" --ip 192.168.56.1 --netmask 255.255.255.0` |
| **Adaptadores trocados** (1 = host-only, 2 = NAT) | O instalador põe a gerência na placa sem internet, e o download das imagens e o build falham | Deixe o Adaptador 1 como NAT e o 2 como host-only. Se o Proxmox já foi instalado assim, é mais simples reinstalar do que corrigir a rede |
| **Adaptador 1 desligado ou sem NAT** | O Proxmox não tem internet: `download-images.sh` e `build-template.sh` falham, e as VPS ficam sem internet | Adaptador 1 = NAT |
| **Modo Bridge** no lugar da host-only | Pode até funcionar, mas a rede passa a ser a do seu roteador, e todos os IPs `192.168.56.x` do projeto deixam de valer | Use host-only. A bridge das VPS é a `vmbr1`, dentro do Proxmox |
| **DHCP da host-only distribuindo `.200` em diante** | Outra VM do VirtualBox pode pegar o IP de uma VPS: conflito de IP, com SSH caindo na máquina errada | `VBoxManage dhcpserver modify --network="HostInterfaceNetworking-VirtualBox Host-Only Ethernet Adapter" --upper-ip=192.168.56.199` |
| **Outra placa do Windows na rede `192.168.56.x`** (uma VPN, outra host-only) | O Windows manda os pacotes pela placa errada | Deixe só a host-only do VirtualBox nessa faixa |

### Rede e IPs diferentes do guia

**Os IPs `192.168.56.x` estão fixos nos scripts do laboratório.** Recomendação: use exatamente a rede do guia. Mudar dá
trabalho e não foi testado. Se precisar, estes são os pontos a alterar:

| Onde | O que está fixo |
|---|---|
| `/etc/network/interfaces` do Proxmox | IP da `vmbr1` e a rede do `MASQUERADE` |
| `scripts/pve/bootstrap.sh`, `firewall.sh`, `download-images.sh` | `PVE_HOST` (aceita variável: `PVE_HOST=10.0.0.10 scripts/pve/…`). O `firewall.sh` também tem `MGMT_NET` |
| `scripts/pve/build-template.sh` | `BUILD_IP` (`.250`) e `GATEWAY` (`.10`), no início do arquivo |
| `scripts/pve/test-template.mjs` | `TEST_IP` (`.229`) e `GATEWAY` |
| `.env.*` (seed) | `IP_POOL_START`, `IP_POOL_END`, `IP_POOL_GATEWAY` (padrão `.200`–`.228`, gateway `.10`). Rode o seed de novo depois |
| `tests/lab/` | `LAB_IP` e o gateway usados pelo `npm run test:lab` |

O IP do Proxmox **não** está no certificado dele, e isso é esperado. A aplicação valida o certificado pela CA do
Proxmox e pelo **nome do nó** (`PVE_TLS_SERVERNAME`), não pelo IP. Por isso trocar o IP não exige um certificado novo.

### Proxmox

| Situação | Sintoma | Correção |
|---|---|---|
| **Símbolos trocados no console da VM** (`/` vira `;`, `'` vira acento, `:` vira `Ç`) | Os comandos do B2 dão erro de sintaxe ou de arquivo não encontrado | O layout de teclado escolhido na instalação não é o do seu teclado físico, e o console não tem outros mapas instalados (`loadkeys` não acha nenhum). Reinstale escolhendo o layout certo, ou digite pela tecla que produz o símbolo no layout escolhido |
| **Rede da `vmbr1` some depois de reiniciar o Proxmox** | Depois de um reboot, o Windows não pinga mais o `192.168.56.10` | O IP foi posto com `ip addr add`, que não é permanente. Configure pelo `/etc/network/interfaces` (instalação, B2) e aplique com `ifreload -a` |
| **ZFS ou Btrfs** na instalação, em vez de ext4 | Não existe o storage `local-lvm`, e o clone falha com *"storage 'local-lvm' does not exist"* | Reinstale com ext4 (recomendado). Alternativa não testada: trocar `STORAGE` no `bootstrap.sh` e no `build-template.sh` e definir `PVE_STORAGE` no `.env.*` |
| **Proxmox VE 8** ou mais antigo | O `bootstrap.sh` falha ao criar a role: ele usa privilégios que só existem no PVE 9 (`VM.GuestAgent.*`) | Use o Proxmox VE 9 |
| Rede das VPS com outra bridge (não `vmbr1`) | Clone ou configuração falham por falta de permissão ou de bridge | Use `vmbr1`, ou troque `BRIDGE` nos scripts e defina `PVE_BRIDGE` no `.env.*` |
| **Linha do `MASQUERADE` diferente** da do guia | `firewall.sh`: *"não achei a linha do MASQUERADE da vmbr1"* | O script procura `post-down iptables -t nat -D POSTROUTING … -o vmbr0 -j MASQUERADE` dentro da `vmbr1` (com ou sem aspas na rede) |
| Repositórios *enterprise* sem assinatura | `apt update` no nó falha com `401 Unauthorized` em `enterprise.proxmox.com` | Não afeta a Favo. Para atualizar o Proxmox, troque para o `pve-no-subscription`: script da comunidade *PVE Post Install*, interface web ou terminal (B3 do guia) |
| As VPS ligam, mas **sem internet** (DNS falha dentro delas) com o firewall ligado | `wget: bad address` dentro da VPS | Falta a *conntrack zone*. Rode `scripts/pve/firewall.sh`, que grava a regra na `vmbr1` |

### SSH e token

| Situação | Sintoma | Correção |
|---|---|---|
| **Proxmox reinstalado no mesmo IP** | *"WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!"*, e os scripts falham com `Host key verification failed` | `ssh-keygen -R 192.168.56.10` e conecte uma vez à mão (`ssh root@192.168.56.10`) para aceitar a chave nova. Faça o mesmo com o IP de uma VPS recriada, se você usa SSH nela (`ssh-keygen -R 192.168.56.200`) |
| **`ssh-keygen -R` não apaga nada** | Ele imprime `known_hosts:<n>: invalid line`, `… is not a valid known_hosts file` e `Not replacing existing known_hosts file because of errors`, e o SSH continua com *"REMOTE HOST IDENTIFICATION HAS CHANGED"* | Uma linha do `~/.ssh/known_hosts` está quebrada. Apague só as linhas do IP: `cp ~/.ssh/known_hosts ~/.ssh/known_hosts.bak && sed -i '/^192\.168\.56\.10[ ,]/d' ~/.ssh/known_hosts` (instalação, B4). Depois, corrija ou apague a linha quebrada |
| **Primeira conexão** nunca feita | Scripts: `Host key verification failed` (eles rodam com `BatchMode=yes` e não perguntam) | Conecte uma vez com `ssh root@192.168.56.10` e responda `yes` |
| Chave do Windows **sem** `id_ed25519` (só `id_rsa`, por exemplo) | O acesso ao Proxmox pode funcionar, mas o teste dos templates e o `npm run test:lab` falham ao ler `~/.ssh/id_ed25519.pub` | `ssh-keygen -t ed25519 -N "" -f ~/.ssh/id_ed25519` e instale a nova chave (instalação, B4) |
| Chave com **senha** (passphrase) | Os scripts param com `Permission denied` | Use uma chave sem senha, ou carregue-a num `ssh-agent` antes |
| **`.env.development` apagado**, com o Proxmox mantido | `bootstrap.sh`: *"o token já existia e … não tem PVE_TOKEN_SECRET"* | `scripts/pve/bootstrap.sh --rotate-token` (gera um *secret* novo; o antigo deixa de valer) |
| Token com *secret* errado | A API responde 401, e `npm run pve -- status` falha | Mesmo remédio: `--rotate-token`, e depois `npm run env:setup`, que copia o secret novo para os outros `.env` |

### Banco de dados e aplicação

| Situação | Sintoma | Correção |
|---|---|---|
| **Usuário `vps_app` de uma instalação anterior** | O `npm run env:setup` diz *"o MySQL recusou: usuário ou senha incorretos"* com a senha que você acabou de escolher no C3 | O `CREATE USER IF NOT EXISTS` não troca a senha de quem já existe. Rode os dois `ALTER USER 'vps_app'@… IDENTIFIED BY '…'` do SQL do C3 (a versão atual do guia já os inclui) |
| **Bancos de uma instalação anterior** com um Proxmox novo | VPS antigas aparecem em **Erro** (*"A máquina virtual não foi encontrada no servidor."*), e o login dos usuários de demonstração falha: o seed não troca a senha de quem já existe | Apague e recrie os bancos (instalação, C3) e rode `npm run db:setup:dev` |
| `.env.*` copiado do `.env.example` sem preencher | A aplicação não sobe e lista as variáveis inválidas (`Variáveis de ambiente inválidas (.env.development)`) | Apague as linhas com `<…>` que vieram do modelo e rode `npm run env:setup`, que só acrescenta o que falta. Para gerar um valor avulso: `npm run env:secret -- <VARIÁVEL>` ([variaveis-de-ambiente.md](variaveis-de-ambiente.md)) |
| `npm test` falha no login ou por falta de `PVE_*` | O `.env.test` está incompleto, ou tem uma `SEED_DEFAULT_PASSWORD` diferente da que o banco de teste já tinha | Rode `npm run env:setup` depois do `bootstrap.sh`. Se o banco de teste é antigo, recrie-o (C3) |
| **Dev e "produção" local ao mesmo tempo** com o mesmo Proxmox | Os dois bancos usam a mesma faixa de IPs (`.200–.228`) e podem dar o mesmo IP a duas VPS | Use um de cada vez, ou dê ao `.env.production` outra faixa (`IP_POOL_START`/`IP_POOL_END`, antes do seed de produção) |
| Processos `node` esquecidos de uma execução anterior | O servidor "velho" responde na porta 3000, ou provisiona VPS sozinho | Feche todos: PowerShell `Get-CimInstance Win32_Process -Filter "Name='node.exe'" \| ? { $_.CommandLine -match 'vps-rental-platform' } \| % { Stop-Process -Id $_.ProcessId -Force }` |
| **Console não conecta** só no seu navegador | A aba Console mostra erro, mas funciona em outro navegador | Uma extensão que intercepta WebSockets foi a causa real neste projeto. Teste numa janela anônima ou sem extensões. As conexões presas podem ser encerradas no painel da aba Console |
| Testes falhando por **timeout** de vez em quando | Falhas diferentes a cada execução, com o Proxmox e navegadores abertos | Falta RAM no Windows. Feche o que não precisa. Os testes comuns não precisam do Proxmox ligado |

## 3. Diagnóstico rápido

Na ordem, do mais baixo para o mais alto:

```powershell
# 1. Windows: hipervisor desligado? (precisa ser False)
(Get-CimInstance Win32_ComputerSystem).HypervisorPresent
# 2. VirtualBox: VT-x aninhado ativo? (NestedHWVirt (1) e nada de "fall back to NEM")
Select-String -Path "$env:USERPROFILE\VirtualBox VMs\<nome>\Logs\VBox.log" -Pattern 'NestedHWVirt|UseNEMInstead|fall back to NEM'
# 3. VM: aninhado "on", NIC 1 = NAT, NIC 2 = host-only com "Promisc Policy: allow-all"?
$vb = "C:\Program Files\Oracle\VirtualBox\VBoxManage.exe"
& $vb showvminfo "<nome>" --machinereadable | Select-String '^(nested-hw-virt|nic[12])='
& $vb showvminfo "<nome>" | Select-String '^NIC [12]:'
# 4. Windows: a placa host-only tem o 192.168.56.1? (se não: instalação, A3, item 4)
Get-NetIPAddress -AddressFamily IPv4 -InterfaceAlias (Get-NetAdapter -InterfaceDescription 'VirtualBox Host-Only Ethernet Adapter').Name
ping -n 2 192.168.56.10
```

```bash
# 5. Proxmox: acessível por chave, com KVM, rede das VPS e templates?
ssh -o BatchMode=yes root@192.168.56.10 'ls /dev/kvm; ip -br addr show vmbr1; qm list'
# 6. A aplicação enxerga o Proxmox com o token?
npm run pve -- status
npm run pve -- capacity
# 7. O servidor está no ar e ligado ao banco?
curl -s http://localhost:3000/api/health
```

Se uma VPS termina em **Erro**, a aba **Histórico** da VPS mostra a etapa que falhou. O log do `npm run dev` mostra o
detalhe técnico: a resposta do Proxmox ou a saída do guest agent. `npm run pve -- task <upid>` mostra o log de uma task
do Proxmox.
