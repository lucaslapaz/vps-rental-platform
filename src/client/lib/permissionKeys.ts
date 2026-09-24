/** Chave de tradução de uma permissão: ":" é o separador de namespace do i18next, então vira "_" (vps:read:own → vps_read_own). */
export const permissionI18nKey = (permission: string) => permission.replace(/[:-]/g, '_');
