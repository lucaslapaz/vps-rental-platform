import type { Request, Response } from 'express';
import { inject, injectable } from 'tsyringe';
import { changeRoleSchema, userSearchSchema, uuidParamSchema } from '../../shared/schemas/account.ts';
import { valid } from '../http/middlewares/validate.ts';
import { AdminUserService } from '../services/AdminUserService.ts';

@injectable()
export class AdminController {
  constructor(@inject(AdminUserService) private readonly admin: AdminUserService) {}

  /** GET /api/admin/users?query= */
  listUsers = async (_req: Request, res: Response) => {
    res.json({ users: await this.admin.search(valid(res, 'query', userSearchSchema).query) });
  };

  /** GET /api/admin/roles */
  listRoles = async (_req: Request, res: Response) => {
    res.json({ roles: await this.admin.listRoles() });
  };

  /** PATCH /api/admin/users/:id/role */
  changeRole = async (req: Request, res: Response) => {
    const actor = req.user as NonNullable<Request['user']>;
    const { id } = valid(res, 'params', uuidParamSchema);
    const { role } = valid(res, 'body', changeRoleSchema);
    res.json(await this.admin.changeRole(actor.id, id, role, req.ip ?? null));
  };
}
