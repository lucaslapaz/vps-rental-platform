# Instalação do zero

Este guia vai de um Windows sem nada instalado até a Favo criando VPS de verdade. Siga as partes na ordem: cada uma
depende da anterior. Se algo não sair como descrito, veja [problemas-comuns.md](problemas-comuns.md), que também explica o
que dá para mudar (senhas, nomes, rede) sem quebrar o projeto.

Combinação testada: Windows 11, VirtualBox 7.2.12 e 7.2.20, Proxmox VE 9.2.2, Node 24.12, MySQL 8.4 e um Intel i3-10100F
com 8 GB de RAM.

**Como ler este guia:** os blocos de comandos `powershell` rodam no PowerShell do Windows. Os blocos `bash` rodam no
**Git Bash**, na raiz do repositório, exceto no B2 e no B3, que rodam **dentro do Proxmox** (no console da VM ou no
*Shell* da interface web), como o texto de cada um diz. Cada passo termina com uma **conferência**: só passe para o
próximo quando ela der o resultado esperado. A maioria dos problemas de instalação aparece mais tarde, longe da causa,
quando uma conferência é pulada.

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

> **Reinstalando por cima de uma instalação anterior?** Quatro coisas sobram no Windows e atrapalham:
> 1. **A chave de host do Proxmox antigo** no `~/.ssh/known_hosts`. O SSH recusa a conexão com *"REMOTE HOST
>    IDENTIFICATION HAS CHANGED"*. O passo [B4](#b4-chave-ssh-do-windows-no-root-do-proxmox) já inclui a limpeza.
> 2. **Os bancos do MySQL**, com VPS que apontam para VMs que não existem mais. Recrie os bancos no passo
>    [C3](#c3-mysql-bancos-e-usuário).
> 3. **O usuário `vps_app` do MySQL**, com a senha antiga. O SQL do C3 já redefine a senha.
> 4. **A VM antiga no VirtualBox:** apague-a em *Máquina → Remover → Apagar todos os arquivos* antes de criar a nova.
>
> O repositório clonado de novo não tem `.env.*` nem `certs/`: eles são recriados nos passos C4 e D1.

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

1. Instale o VirtualBox 7.2 (testado na 7.2.12 e na 7.2.20).
2. Confira a rede **host-only**. Ela é uma rede privada entre o Windows e as VMs, e é por ela que a Favo fala com o
   Proxmox e que você acessa as VPS. Em *Arquivo → Ferramentas → Gerenciador de Rede → Redes Host-only* precisa existir um
   adaptador com IPv4 **`192.168.56.1`** e máscara **`255.255.255.0`**. O VirtualBox cria um assim na instalação, chamado
   `VirtualBox Host-Only Ethernet Adapter`. Pelo PowerShell:

   ```powershell
   $vb = "C:\Program Files\Oracle\VirtualBox\VBoxManage.exe"
   & $vb list hostonlyifs      # procure IPAddress: 192.168.56.1
   & $vb list dhcpservers      # veja o DHCP dessa rede
   ```

   As duas listas falam de coisas diferentes, e é normal que pareçam se contradizer:
   - Em `list hostonlyifs`, a linha **`DHCP: Disabled`** diz que o **próprio Windows** usa um IP fixo nessa placa. É o
     certo: o Windows precisa ser sempre o `192.168.56.1`.
   - `list dhcpservers` mostra o **servidor DHCP do VirtualBox**, que dá IPs para as VMs ligadas a essa rede. Ele pode
     estar `Enabled: Yes`; o que importa é a faixa (item 3).

3. **O DHCP da host-only não pode distribuir os IPs de `.200` em diante**, porque eles são das VPS e do build dos
   templates. Se o `list dhcpservers` mostrar um servidor para essa rede com `UpperIPAddress` acima de `.199`, limite a
   faixa:

   ```powershell
   & $vb dhcpserver modify --network="HostInterfaceNetworking-VirtualBox Host-Only Ethernet Adapter" --upper-ip=192.168.56.199
   ```

   Se não houver servidor DHCP nessa rede, ou se a faixa já terminar em `.199` ou antes, não há nada a fazer.

4. **Confira o IP do Windows na placa host-only.** O VirtualBox guarda o `192.168.56.1` na configuração da placa, mas
   em alguns PCs o Windows perde esse IP ao reiniciar (a placa volta com um endereço `169.254.x.x` ou sem IPv4), e aí o
   Windows deixa de alcançar o Proxmox e as VPS. Para conferir:

   ```powershell
   $hostonly = (Get-NetAdapter -InterfaceDescription 'VirtualBox Host-Only Ethernet Adapter').Name
   Get-NetIPAddress -AddressFamily IPv4 -InterfaceAlias $hostonly | Format-Table IPAddress,PrefixLength,PrefixOrigin
   ```

   Tem que aparecer **`192.168.56.1`, `24`, `Manual`**. Se não aparecer, grave o IP fixo de novo (não precisa de
   administrador) e confira outra vez:

   ```powershell
   & $vb hostonlyif ipconfig "VirtualBox Host-Only Ethernet Adapter" --ip 192.168.56.1 --netmask 255.255.255.0
   ```

   **Guarde esses dois comandos:** se um dia, depois de reiniciar o PC, o `ping 192.168.56.10` parar de responder com a
   VM do Proxmox ligada, é aqui que se começa.

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
  Adapter`, *Avançado → Modo Promíscuo: **Permitir Tudo***. Esse campo fica escondido em *Avançado* e é fácil de
  esquecer; o A5 confere.
- *Sistema → Processador → "Habilitar VT-x/AMD-V Aninhado"*: **essa caixa costuma ficar acinzentada e não dá para
  marcar.** Isso é normal e não é um defeito do seu PC. Pule-a: o **A5 liga o VT-x aninhado por comando**. A caixa
  continua acinzentada mesmo depois disso; a conferência é feita no A5.

O que importa e o que é indiferente nesta VM:

| Importa (o A5 confere) | Tanto faz |
|---|---|
| VT-x aninhado ligado | Tipo/versão escolhidos (*Debian*, *Oracle Linux*…) |
| Adaptador 1 = NAT, Adaptador 2 = host-only com modo promíscuo *Permitir Tudo* | Ordem de boot e disquete na lista |
| BIOS (EFI desmarcado) | 2 ou mais CPUs, se o PC tiver núcleos sobrando |
| ~3 GB de RAM e disco de 30 GB ou mais | Controlador de vídeo e memória de vídeo |

**3 GB de RAM, e não mais:** com 8 GB no PC, o Windows fica com pouca memória livre com o Proxmox ligado. Com 3 GB, o
Proxmox usa ~1,4 GB, e sobram ~1,5 GB para as VPS. É para isso que a capacidade da Favo está calibrada
(`CAPACITY_MAX_MEMORY_MB=1536`). Se você der mais RAM ao Proxmox, pode aumentar esse valor.

### A5. Conferir e corrigir a VM (obrigatório, nos dois jeitos)

Este passo vale para quem criou a VM pelo PowerShell **e** pela interface. Ele pega os dois erros mais comuns da
instalação: o **VT-x aninhado desligado** (nenhuma VPS liga) e o **modo promíscuo** do Adaptador 2 fora de *Permitir
Tudo* (as VPS ligam, mas o Windows não as alcança). Nenhum dos dois dá erro na hora: os sintomas só aparecem no D3.

Em **toda janela nova do PowerShell**, defina antes as duas variáveis que o guia usa daqui em diante. O nome da VM é o
que você escolheu; `list vms` mostra os nomes:

```powershell
$vb = "C:\Program Files\Oracle\VirtualBox\VBoxManage.exe"
& $vb list vms
$vm = "<nome da VM do Proxmox>"      # exatamente como aparece no list vms, entre aspas
```

**1. Confira a configuração** (pode ser com a VM ligada):

```powershell
& $vb showvminfo $vm --machinereadable | Select-String '^(nested-hw-virt|firmware|memory|nic[12])='
& $vb showvminfo $vm | Select-String '^NIC [12]:'
```

| Tem que aparecer | Se estiver diferente |
|---|---|
| `nested-hw-virt="on"` | Corrija (item 2) |
| `firmware="BIOS"` | EFI: recrie a VM com EFI desmarcado |
| `nic1="nat"` e `nic2="hostonly"` | Ajuste os adaptadores em *Configurações → Rede* |
| Linha `NIC 2:` com `Host-only Interface 'VirtualBox Host-Only Ethernet Adapter'` e **`Promisc Policy: allow-all`** | `Promisc Policy: deny` ou `allow-vms`: corrija (item 2) |

**2. Corrija, se precisar.** Os dois ajustes só são aceitos com a VM **desligada**. Se o Proxmox já estiver instalado e
ligado, desligue-o de forma limpa e espere o estado `poweroff`:

```powershell
& $vb controlvm $vm acpipowerbutton                                     # só se a VM estiver ligada
& $vb showvminfo $vm --machinereadable | Select-String '^VMState='      # repita até mostrar "poweroff"
& $vb modifyvm $vm --nested-hw-virt=on --nic-promisc2=allow-all
```

O `--nested-hw-virt=on` é o jeito normal de ligar a opção que fica acinzentada na interface: a interface não deixa
marcar a caixa, mas o comando grava a opção direto na configuração da VM. **Mesmo depois do comando, a caixa continua
acinzentada** e não pode ser alterada pela interface (nem para ligar, nem para desligar). Por isso, **não se guie pela
caixa**: o que vale é o `nested-hw-virt="on"` do item 1 e o `NestedHWVirt ... (1)` do item 3. Rode o item 1 de novo
para conferir. Para desligar um dia, também é por comando: `--nested-hw-virt=off`, com a VM desligada.

**3. Confira no log que o VT-x chegou à VM.** Ligue a VM com uma janela (`& $vb startvm $vm`) e, com ela ligada:

```powershell
Select-String -Path "$env:USERPROFILE\VirtualBox VMs\$vm\Logs\VBox.log" -Pattern 'NestedHWVirt|UseNEMInstead|HMR3Init|fall back to NEM'
```

| Tem que aparecer | Se aparecer isto, algo está errado |
|---|---|
| `NestedHWVirt ... (1)` | `NestedHWVirt ... (0)`: o aninhado está desligado. Volte ao item 2 |
| `UseNEMInstead ... (0)` e `HM: HMR3Init: VT-x w/ nested paging…` | `Attempting fall back to NEM` ou `UseNEMInstead (1)`: o Hyper-V está ativo. Volte ao A2 |

Se a VM não estiver na pasta padrão do VirtualBox, o log fica na pasta dela (`CfgFile` no `showvminfo --machinereadable`),
em `Logs\VBox.log`.

---

## Parte B — Proxmox

### B1. Instalar

Na janela da VM, escolha **Install Proxmox VE (Graphical)** e preencha:

| Tela | O que escolher | Por quê |
|---|---|---|
| Target Harddisk | O disco de 30 GB, com o filesystem **ext4** (o padrão) | O ext4 cria o storage **`local-lvm`** (LVM thin), onde ficam as VPS e os clones vinculados. ZFS ou Btrfs criariam outro storage (ver problemas-comuns) |
| Target Harddisk → *Options* (recomendado) | **`maxroot` = 10** e **`minfree` = 2**; o resto no padrão | Veja "Espaço para as VPS" logo abaixo |
| País, fuso e teclado | Os seus. O **layout do teclado** tem que ser o do seu teclado físico (ex.: *Portuguese (Brazil)* para ABNT2, *U.S. English* para o americano) | O teclado vale para o console da VM, usado no B2 para digitar `/`, `>` e `-`. Com o layout errado, esses símbolos saem trocados e não dá para trocar o layout depois pelo console (os mapas de teclado não vêm instalados) |
| Senha do root e e-mail | Os que quiser | A senha só é usada no login da interface web e **uma vez**, para instalar a chave SSH (B4). O projeto não a guarda |
| Management Interface | **`nic0`** (ou a primeira placa da lista) | É o Adaptador 1 (NAT), a única rede com internet. Confira: o MAC mostrado é o do Adaptador 1 nas configurações da VM |
| Hostname (FQDN) | Um nome com domínio, ex.: `pve.laboratorio.local` | A primeira parte (`pve`) vira o **nome do nó**. Qualquer nome serve: os scripts o descobrem sozinhos |
| IP / Gateway / DNS | `10.0.2.15/24` / `10.0.2.2` / o que o instalador sugerir | São os valores do NAT do VirtualBox |

No fim, deixe reiniciar. A VM inicia pelo disco. Se quiser, tire a ISO do drive em *Dispositivos → Discos Ópticos*.

**Espaço para as VPS (`maxroot` e `minfree`).** O instalador divide o disco em quatro partes: a raiz do Proxmox (`root`),
o swap, uma sobra livre (`minfree`) e o `local-lvm` (`data`), que recebe **o que sobrar**. Segundo a
[documentação oficial](https://pve.proxmox.com/pve-docs/chapter-pve-installation.html) (*Advanced LVM Configuration
Options*), em discos menores que 48 GiB a raiz fica com **metade do disco** e a sobra com 1/8. Num disco de 35 GB com os padrões, o
`local-lvm` ficou com só **9,6 GiB**, e os quatro templates ocupam ~3,8 GiB dele. Com `maxroot` = 10 GB e `minfree` = 2 GB,
a raiz continua com folga (o Proxmox e as imagens do D2 usam ~4,5 GB) e o `local-lvm` fica com a maior parte do disco.

Os padrões também funcionam: a Favo confere o espaço livre de verdade antes de aceitar cada VPS, então o único efeito
é caber menos VPS. Depois do B4, `ssh root@192.168.56.10 pvesm status` mostra o tamanho do `local-lvm`.

### B2. Rede das VPS (`vmbr1`), pelo console da VM

Logo depois da instalação, o Windows ainda **não alcança** o Proxmox: o único IP dele é o do NAT. Este passo é feito na
**janela da VM**. Entre como `root`, com a senha escolhida. Os comandos usam `/`, `>` e `-`: se esses símbolos saírem
trocados na tela, o layout de teclado escolhido no B1 não é o do seu teclado (veja problemas-comuns).

1. Confira os nomes das placas: `ip -br link`. Devem aparecer `nic0` e `nic1`, e a `nic1` aparece como `DOWN` (ainda
   não está em uso). Compare o MAC da `nic1` com o do Adaptador 2 do VirtualBox, que o VirtualBox mostra sem os
   dois-pontos (por exemplo, `08:00:27:ab:cd:ef` no Proxmox = `080027ABCDEF` no VirtualBox).
2. Faça uma cópia do arquivo de rede e abra o editor:

   ```bash
   cp /etc/network/interfaces /root/interfaces.orig
   nano /etc/network/interfaces
   ```

3. O instalador já escreveu a `vmbr0`, sobre a `nic0`, a linha `iface nic1 inet manual` e, por último, uma linha
   `source /etc/network/interfaces.d/*`. Se a linha da `nic1` não existir, acrescente-a. **Acrescente o bloco abaixo no
   fim do arquivo** (depois do `source`, sem problema), sem aspas, como está. O `scripts/pve/firewall.sh` procura a
   linha do `MASQUERADE` depois. A indentação pode ser com Tab ou espaços:

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

   No fim, o arquivo inteiro fica assim (o `10.0.2.15` e o `10.0.2.2` são os do B1):

   ```
   auto lo
   iface lo inet loopback

   iface nic0 inet manual

   auto vmbr0
   iface vmbr0 inet static
   	address 10.0.2.15/24
   	gateway 10.0.2.2
   	bridge-ports nic0
   	bridge-stp off
   	bridge-fd 0

   iface nic1 inet manual

   source /etc/network/interfaces.d/*

   auto vmbr1
   iface vmbr1 inet static
   	address 192.168.56.10/24
   	... (as outras linhas do bloco acima)
   ```

4. Salve com `Ctrl+O`, `Enter` e `Ctrl+X`. Aplique com `ifreload -a` e confira no console:

   ```bash
   ip -br addr show vmbr1                  # 192.168.56.10/24, estado UP
   iptables -t nat -S POSTROUTING          # a linha -A POSTROUTING -s 192.168.56.0/24 -o vmbr0 -j MASQUERADE
   cat /proc/sys/net/ipv4/ip_forward       # 1
   ```

   **Configure a rede só pelo arquivo.** Um IP posto à mão com `ip addr add` também funciona, mas some quando o Proxmox
   reinicia. O que está no `/etc/network/interfaces` volta sozinho a cada boot.
5. No Windows: `ping 192.168.56.10` deve responder, e **https://192.168.56.10:8006** deve abrir a interface web, depois
   do aviso de certificado. Entre com `root`, realm *Linux PAM*. Se o ping não responder, confira o IP do Windows na
   host-only (A3, item 4).
6. **Confira que a rede sobrevive a um reinício.** No PowerShell (com `$vb` e `$vm` do A5), reinicie a VM e espere a
   interface web voltar (~1 a 2 minutos). O `ping 192.168.56.10` tem que voltar a responder sem você fazer nada no console:

   ```powershell
   & $vb controlvm $vm acpipowerbutton     # desliga de forma limpa
   & $vb showvminfo $vm --machinereadable | Select-String '^VMState='   # repita até "poweroff"
   & $vb startvm $vm --type headless
   ping -n 60 192.168.56.10                # as respostas começam em ~1 minuto; Ctrl+C para parar
   ```

Daqui em diante, a janela da VM não é mais necessária. Para ligar o Proxmox sem janela no dia a dia:
`& $vb startvm $vm --type headless`. Para desligar de forma limpa: `& $vb controlvm $vm acpipowerbutton`. Se o PC
reiniciar, ligue a VM de novo e, se o Windows não pingar o `.10`, veja o A3, item 4.

### B3. Repositórios de atualização (o `apt update` dá erro 401)

O Proxmox VE vem com os repositórios **enterprise** (`enterprise.proxmox.com`) ativados por padrão, tanto o do
Proxmox quanto o do Ceph. Eles só funcionam com uma **assinatura paga**. Sem ela, o `apt update` no nó falha assim
(erro reproduzido neste laboratório):

```
Err:1 https://enterprise.proxmox.com/debian/pve trixie InRelease
  401  Unauthorized [IP: … 443]
E: Failed to fetch https://enterprise.proxmox.com/debian/pve/dists/trixie/InRelease  401  Unauthorized [IP: … 443]
```

A [documentação oficial](https://pve.proxmox.com/wiki/Package_Repositories) diz o mesmo: é preciso uma chave de
assinatura para acessar o `pve-enterprise`. Quem não tem assinatura deve desativá-lo com uma linha `Enabled: no` e
configurar o repositório **`pve-no-subscription`**, que é gratuito e indicado para testes e uso fora de produção.

**A Favo não usa o `apt` do nó.** Os scripts do repositório instalam pacotes dentro das VMs, não no Proxmox. Então
este passo só é necessário se você quiser atualizar o Proxmox ou instalar algo nele. Escolha **um** dos três caminhos.

**Caminho 1: script da comunidade "PVE Post Install" (o usado neste laboratório).** O
[community-scripts.org](https://community-scripts.org/scripts?q=proxmox&preview=post-pve-install) mantém scripts prontos
para o Proxmox. Esse é o antigo *tteck Proxmox VE Helper Scripts*, com licença MIT; o código está em
[GitHub](https://github.com/community-scripts/ProxmoxVE/blob/main/tools/pve/post-pve-install.sh). Ele corrige os
repositórios, pode tirar o aviso de assinatura da interface web e desligar os serviços de cluster, que um nó só não usa.
Rode como root no Proxmox: pelo console da VM, por SSH ou pelo *Shell* do nó na interface web.

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/community-scripts/ProxmoxVE/main/tools/pve/post-pve-install.sh)"
```

Ele faz uma pergunta por etapa. Respostas para este laboratório:

| Pergunta do script | Resposta | Por quê |
|---|---|---|
| *SOURCES* (corrigir as fontes / formato deb822) | yes | Deixa os repositórios do Debian e do Proxmox no formato do PVE 9 |
| *PVE-ENTERPRISE* | disable | É o repositório que dá o erro 401 |
| *CEPH ENTERPRISE* | disable | Mesmo problema, com o repositório do Ceph |
| *PVE-NO-SUBSCRIPTION* | yes | O repositório gratuito, o que faz o `apt update` funcionar |
| *CEPH PACKAGE REPOSITORIES* | yes ou no | A Favo não usa o Ceph |
| *PVETEST* | no | Repositório de testes, desnecessário |
| *SUBSCRIPTION NAG* | yes, se quiser | Só tira o aviso "No valid subscription" do login da interface web |
| *HIGH AVAILABILITY* (desabilitar) e *COROSYNC* | yes | São serviços de cluster; num nó só, liberam um pouco de RAM |
| *UPDATE* | yes | Atualiza o Proxmox (leva alguns minutos) |
| *REBOOT* | yes | Recomendado depois da atualização |

Cuidados:
- É um script de **terceiros**, que roda como root e **não é oficial do Proxmox**. Se quiser, leia-o antes (link acima).
- O script confere a versão e **para** em versões que ainda não conhece. Em 2026-09-25, ele aceitava o PVE 8.0–8.9 e o
  9.0–9.2. Numa versão mais nova, use o caminho 2 ou 3.
- Depois dele, recarregue a interface web com `Ctrl+Shift+R`, como o próprio script avisa.

**Caminho 2: pela interface web (oficial).** Vá em *nó → Atualizações → Repositórios* (*Updates → Repositories*):
1. Selecione o `pve-enterprise` e clique em **Desabilitar**. Faça o mesmo com o repositório *enterprise* do Ceph.
2. Clique em **Adicionar** e escolha **No-Subscription**.
3. Em *Atualizações*, clique em **Atualizar** (*Refresh*).

**Caminho 3: pelo terminal (oficial, testado neste laboratório).** Como root no Proxmox:

```bash
# desativa os repositórios enterprise (a doc oficial manda acrescentar "Enabled: no")
for f in /etc/apt/sources.list.d/pve-enterprise.sources /etc/apt/sources.list.d/ceph.sources; do
  [ -f "$f" ] && ! grep -q '^Enabled:' "$f" && echo 'Enabled: no' >> "$f"
done
# repositório gratuito (conteúdo da doc oficial, PVE 9 / Debian trixie)
cat > /etc/apt/sources.list.d/proxmox.sources <<'EOF'
Types: deb
URIs: http://download.proxmox.com/debian/pve
Suites: trixie
Components: pve-no-subscription
Signed-By: /usr/share/keyrings/proxmox-archive-keyring.gpg
EOF
apt update
```

O `apt update` tem que terminar sem `401` e sem `Err:`; no fim, ele diz quantos pacotes podem ser atualizados. **Atualizar
é opcional** (`apt full-upgrade`, alguns minutos, depois `reboot`): os templates e a Favo funcionam com o Proxmox como
veio da ISO. Se atualizar, faça antes do D3, e confira depois do reboot que o `ping 192.168.56.10` volta.

### B4. Chave SSH do Windows no root do Proxmox

Os scripts do repositório entram no Proxmox por SSH **com chave, sem senha**. O teste dos templates e os testes `@lab`
entram nas VPS com a chave **`~/.ssh/id_ed25519`** do Windows. No **Git Bash**:

**1. Apague a chave de host de um Proxmox antigo** (se você já usou o `192.168.56.10` antes):

```bash
ssh-keygen -R 192.168.56.10
```

Leia a saída. Os resultados possíveis:
- `Host 192.168.56.10 found: line …` e `… updated.`: apagou. Siga em frente.
- Nada, ou `not found`: não havia chave antiga. Siga em frente.
- **`… is not a valid known_hosts file` e `Not replacing existing known_hosts file because of errors`**: **não apagou
  nada.** Alguma linha do seu `known_hosts` está quebrada (o número dela aparece na mensagem, em `known_hosts:<linha>:
  invalid line`), e o `ssh-keygen` se recusa a mexer no arquivo. Apague só as linhas do `192.168.56.10`, com um backup:

  ```bash
  cp ~/.ssh/known_hosts ~/.ssh/known_hosts.bak
  sed -i '/^192\.168\.56\.10[ ,]/d' ~/.ssh/known_hosts
  ```

  A linha quebrada não tem relação com o projeto; corrija-a ou apague-a quando quiser.

**2. Crie a chave (se não existir) e instale-a no root do Proxmox:**

```bash
[ -f ~/.ssh/id_ed25519 ] || ssh-keygen -t ed25519 -N "" -f ~/.ssh/id_ed25519
cat ~/.ssh/id_ed25519.pub | ssh root@192.168.56.10 'cat >> /root/.ssh/authorized_keys'
```

O último comando pergunta se você confia no servidor (responda `yes`) e pede a senha do root, só desta vez. Se aparecer
*"REMOTE HOST IDENTIFICATION HAS CHANGED"*, a chave antiga continua lá: volte ao item 1.

**3. Confira** que o acesso por chave funciona e que o KVM está disponível dentro do Proxmox:

```bash
ssh -o BatchMode=yes root@192.168.56.10 'pveversion; ls /dev/kvm; grep -c vmx /proc/cpuinfo; pvesm status'
```

Deve imprimir a versão, `/dev/kvm`, um número maior que zero e os storages `local` e `local-lvm`, os dois `active`. Se
pedir senha, a chave não foi instalada. Se o `/dev/kvm` não existir, o VT-x aninhado não chegou ao Proxmox: volte ao
A5. A coluna *Total* do `local-lvm` é o espaço para os templates e as VPS (B1, "Espaço para as VPS").

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

Rode o SQL abaixo, trocando `TROQUE_ESTA_SENHA` pela senha que você quer para o `vps_app` (são **quatro** lugares: dois
`CREATE USER` e dois `ALTER USER`). Prefira letras e números: a senha vai dentro de uma URL. O script do próximo passo
codifica caracteres especiais, mas uma senha simples evita surpresas. Anote a senha: o C4 pede.

O SQL pode ser rodado mais de uma vez. O `CREATE USER IF NOT EXISTS` **não muda a senha de um usuário que já existe**
(de uma instalação anterior, por exemplo), por isso os dois `ALTER USER` vêm logo depois: eles garantem que a senha
passa a ser a que você escreveu agora.

```sql
CREATE DATABASE IF NOT EXISTS vps_platform_dev    CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE DATABASE IF NOT EXISTS vps_platform_test   CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE DATABASE IF NOT EXISTS vps_platform_prod   CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE DATABASE IF NOT EXISTS vps_platform_shadow CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE USER IF NOT EXISTS 'vps_app'@'localhost' IDENTIFIED BY 'TROQUE_ESTA_SENHA';
CREATE USER IF NOT EXISTS 'vps_app'@'127.0.0.1' IDENTIFIED BY 'TROQUE_ESTA_SENHA';
ALTER USER 'vps_app'@'localhost' IDENTIFIED BY 'TROQUE_ESTA_SENHA';
ALTER USER 'vps_app'@'127.0.0.1' IDENTIFIED BY 'TROQUE_ESTA_SENHA';
GRANT ALL PRIVILEGES ON vps_platform_dev.*    TO 'vps_app'@'localhost', 'vps_app'@'127.0.0.1';
GRANT ALL PRIVILEGES ON vps_platform_test.*   TO 'vps_app'@'localhost', 'vps_app'@'127.0.0.1';
GRANT ALL PRIVILEGES ON vps_platform_prod.*   TO 'vps_app'@'localhost', 'vps_app'@'127.0.0.1';
GRANT ALL PRIVILEGES ON vps_platform_shadow.* TO 'vps_app'@'localhost', 'vps_app'@'127.0.0.1';
```

Para conferir, saia do cliente (`exit`) e entre como o `vps_app` com a senha nova. Os quatro bancos têm que aparecer:

```powershell
& "C:\Program Files\MySQL\MySQL Server 8.4\bin\mysql.exe" -uvps_app -p -h127.0.0.1 -e "SHOW DATABASES"
```

- **Os bancos são de uma instalação anterior?** Eles guardam VPS de um Proxmox que não existe mais, e os usuários de
  demonstração com a senha antiga. Para começar limpo, **apague-os** com o comando abaixo e rode o SQL acima de novo.
  Isso apaga todos os dados da Favo nesses bancos:
  `DROP DATABASE vps_platform_dev; DROP DATABASE vps_platform_test; DROP DATABASE vps_platform_prod; DROP DATABASE vps_platform_shadow;`

### C4. Arquivos de configuração (`.env.*`)

A aplicação lê `.env.development` (`npm run dev`), `.env.test` (testes) e `.env.production` (`npm start`). Eles ficam
**fora do git**. Não copie o [.env.example](../.env.example) à mão. Rode o **assistente**:

```bash
npm run env:setup
```

Ele faz perguntas no console. Enter aceita o valor entre colchetes, e onde cabe uma senha, Enter gera uma aleatória:

| Pergunta | Padrão | Observação |
|---|---|---|
| MySQL: endereço | `127.0.0.1:3306` | |
| MySQL: usuário da aplicação | `vps_app` | O do passo C3 |
| MySQL: senha | — | A do passo C3, sem aparecer na tela no PowerShell ou no cmd. O assistente **testa a conexão** e confere se os quatro bancos existem antes de continuar |
| Senha dos usuários de demonstração | gerada | Digite uma, se quiser uma fácil de lembrar (mínimo 10 caracteres) |
| Porta do servidor | `3000` | |
| Acelerar a cobrança para demonstração? | não | "Sim" faz o mês de cobrança durar 30 minutos (`BILLING_TIME_SCALE=1440`) |
| Criar também o `.env.production`? | não | Se sim, pergunta o e-mail e a senha do administrador de produção |

No fim, mostra um resumo do que vai gravar e pede confirmação.
- **Não pergunta segredos nem tokens:** `CSRF_SECRET` e `JOB_SECRET_KEY` são gerados sozinhos, e as `PVE_*` vêm do
  passo D1.
- **Nunca troca um valor que já existe.** Rodar de novo só pergunta o que falta.
- Sem perguntas, para automatizar: `DB_PASSWORD=<senha> npm run env:setup -- --yes` usa os padrões.

Ele avisa que ainda faltam as variáveis do Proxmox (`PVE_*`). Elas vêm no passo D1.

O que é cada variável, o formato de cada segredo e como gerar um valor novo para uma variável específica
(`npm run env:secret -- <VARIÁVEL>`) estão em [variaveis-de-ambiente.md](variaveis-de-ambiente.md).

| Variável | De onde vem | Para que serve |
|---|---|---|
| `DATABASE_URL`, `SHADOW_DATABASE_URL` | `npm run env:setup` (C4) | Conexão com o MySQL. O shadow é usado pelo `prisma migrate dev` |
| `SEED_DEFAULT_PASSWORD` | `npm run env:setup` (C4), aleatória | **Senha dos usuários de demonstração** (`ana@favo.local` e os outros) |
| `CSRF_SECRET`, `JOB_SECRET_KEY` | `npm run env:setup` (C4), aleatórias | Assinatura do token CSRF e cifra das senhas nos jobs |
| `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` | `npm run env:setup`, se você pedir o `.env.production` | Admin inicial do banco de produção |
| `PVE_URL`, `PVE_NODE`, `PVE_TLS_SERVERNAME`, `PVE_CA_FILE`, `PVE_TOKEN_ID`, `PVE_TOKEN_SECRET` | `scripts/pve/bootstrap.sh` (D1) | Acesso ao Proxmox com o token da plataforma (um *API Token* do Proxmox, criado pelo próprio Proxmox) |

---

## Parte D — Proxmox para a Favo

Tudo aqui roda no **Git Bash**, na raiz do repositório. Os scripts entram no Proxmox por SSH (B4) e são idempotentes:
rodar de novo não estraga nada. Todos aceitam `PVE_HOST=<ip>` se o Proxmox não estiver em `192.168.56.10`.

### D1. Identidade da plataforma (token)

```bash
scripts/pve/bootstrap.sh
npm run env:setup                  # copia as PVE_* para o .env.test (e o .env.production); só pede confirmação
```

O `bootstrap.sh` termina com `[bootstrap] concluído`. A segunda execução do `env:setup` não repete as perguntas: mostra
`copiar do .env.development: PVE_URL, …` e pede `Gravar? (S/n)` (Enter grava). **Siga para o D2**, mesmo que o assistente
já fale da parte E: sem as imagens e os templates, nenhuma VPS pode ser criada.

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
o checksum bater. Leva poucos minutos, conforme a sua internet. Conferência: uma linha `baixado, sha… confere` (ou `já
baixado, sha… confere`) para cada imagem e, no fim, `[imagens] pronto`.

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

**Leva uns 10 minutos para os quatro** (medido com uma boa internet), e a Desktop é a mais demorada. O terminal fica
parado por um ou dois minutos em alguns momentos (download de pacotes, boot da VM): é normal. Depois de cada template, o
script roda sozinho o teste de aceite (`scripts/pve/test-template.mjs`), **com o token da plataforma**, não com o root:
- cria um clone com o IP `.229`;
- confere ping, SSH com a sua chave, DNS, `sudo`/`doas`, disco, guest agent, senha root e console;
- apaga o clone;
- confere que o token **não** consegue apagar o template.

**Conferência:** cada verificação aparece com ✅, e nenhuma com ❌; cada template termina com `template protegido:
DELETE com o token → 403`. Se o ping ou o SSH a partir do Windows falharem, mas o `agent/ping` passar, o modo promíscuo
do Adaptador 2 está errado (A5). Estas mensagens aparecem no meio do log e **são normais**:
- `userdel: … mail spool (/var/mail/…) not found`: a limpeza do usuário do build, que não tinha caixa de correio;
- `qm> screendump …`: o eco do monitor do QEMU ao capturar a tela;
- centenas de linhas `(n/349) Installing …`: a instalação do XFCE na Desktop.

O teste salva a tela de cada template em `test-results/pve/<vmid>-<imagem>-vga.png`. Abra a da Desktop
(`9003-alpine-desktop-vga.png`): ela tem que mostrar a tela de login gráfico, com o usuário `favo`. As outras mostram o
login de texto.

Os quatro templates ocupam ~3,8 GiB do `local-lvm`. Também dá para construir um template de cada vez:
`scripts/pve/build-template.sh alpine`, `debian`, `ubuntu` ou `alpine-desktop`. Se tiver pouco tempo, comece pelo
`alpine`: é o mais leve e o suficiente para testar.

### D4. Firewall anti-spoofing

```bash
scripts/pve/firewall.sh
```

O script liga o firewall do Proxmox, que por padrão aceita todo o tráfego do nó, só para permitir o anti-spoofing: cada
VPS só consegue usar o próprio IP e MAC. Ele também grava na `vmbr1` a regra de *conntrack zone* que mantém o NAT das VPS
funcionando com o firewall ligado. Antes de ligar, agenda um *rollback* automático de 3 minutos, e só o cancela depois
de confirmar que o SSH e a porta 8006 continuam acessíveis. Conferência: a última linha é `SSH e 8006 acessíveis daqui:
rollback cancelado. Firewall do datacenter ligado.`

---

## Parte E — Rodar e conferir

```bash
npm run db:setup:dev                                   # cria as tabelas e o seed (planos, imagens, IPs e usuários) no banco de dev
npx cross-env NODE_ENV=test prisma migrate deploy      # cria as tabelas no banco de teste (os testes fazem o seed sozinhos)
npm run pve -- status                                  # o servidor enxerga o Proxmox com o token?
npm run pve -- capacity                                # RAM e disco disponíveis para VPS
npm run dev                                            # http://localhost:3000
```

O que cada um deve mostrar:
- `db:setup:dev`: no fim, `Seed concluído.`, com `IPs 192.168.56.200–192.168.56.228: 29` e `usuários: 5`;
- `migrate deploy`: `All migrations have been successfully applied.`;
- `pve -- status`: `API: ok`, o nome do nó e o uso de RAM e do `local-lvm`;
- `npm run dev`: a linha **`worker de jobs iniciado`**. Enquanto ele roda, `curl -s http://localhost:3000/api/health`
  (em outro Git Bash) mostra `"database":"ok"` e `"proxmox":"ok"`.

O `npm run dev` ocupa o terminal: deixe-o aberto e use outro para os comandos seguintes. Depois, no navegador:

1. Abra http://localhost:3000 e entre com **`ana@favo.local`**. A senha está em `SEED_DEFAULT_PASSWORD`, no
   `.env.development`. Os outros usuários são `bruno@` (cliente), `carla@` e `diego@` (suporte) e `admin@`, todos
   `@favo.local` e com a mesma senha. O console do navegador mostra um erro `401` no `/api/auth/me` antes do login: é
   esperado.
2. **VPS → Criar VPS**: imagem Alpine, plano Nano e o acesso. Com *Chave SSH* (o padrão), cole a sua chave pública em
   *Colar uma chave nova* (`cat ~/.ssh/id_ed25519.pub` no Git Bash mostra a linha inteira). Anote o **Nome de usuário**
   (o padrão é o nome da imagem: `alpine`, `debian` ou `ubuntu`). Clique em **Criar e pagar**.
3. No pagamento, use o cartão de teste **`4242 4242 4242 4242`** (aprovado; o botão *Usar* ao lado dele preenche o
   número e o nome), a validade que já vem preenchida e qualquer **CVC** de 3 dígitos. Clique em **Pagar**. Os cartões `4000 0000 0000 0002`
   (recusado) e `4000 0000 0000 9995` (saldo insuficiente) testam os erros.
4. Depois do pagamento aprovado, a Favo volta para a lista **Minhas VPS**. Clique no nome da VPS: a página dela mostra
   a criação ao vivo (*Criando a sua VPS*), e em ~30–40 s a VPS fica **Ligada**. O passo a passo fica depois na aba
   **Histórico**.
5. Teste o acesso:
   - aba **Console**: tem que aparecer *Conectado* e a tela da VPS (as mensagens do boot e o `login:`);
   - SSH pelo Git Bash: a aba *Visão geral* mostra o comando pronto, em *Conectar por SSH* (por exemplo,
     `ssh alpine@192.168.56.200`). Na primeira vez, responda `yes`. Se o IP já foi de outra VPS, apague a chave antiga
     com `ssh-keygen -R 192.168.56.200`.

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
