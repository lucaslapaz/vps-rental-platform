// O @novnc/novnc 1.7 exporta o RFB em "." (core/rfb.js), mas os tipos (@types/novnc__novnc 1.6, uma versão atrás)
// só declaram o caminho antigo "@novnc/novnc/lib/rfb". Este shim reaproveita aquelas declarações (CLAUDE.md N8).
declare module '@novnc/novnc' {
  import RFB from '@novnc/novnc/lib/rfb';
  export default RFB;
}
