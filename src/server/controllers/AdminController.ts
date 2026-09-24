import type { Request, Response } from 'express';
import { inject, injectable } from 'tsyringe';
import { changeRoleSchema, userSearchSchema, uuidParamSchema } from '../../shared/schemas/account.ts';
import {
  adminJobsQuerySchema,
  adminVpsQuerySchema,
  createRoleSchema,
  roleKeyParamSchema,
  updateRoleSchema,
} from '../../shared/schemas/admin.ts';
import { valid } from '../http/middlewares/validate.ts';
import { AdminService } from '../services/AdminService.ts';
import { AdminUserService } from '../services/AdminUserService.ts';

const actorOf = (req: Request) => req.user as NonNullable<Request['user']>;

@injectable()
export class AdminController {
  constructor(
    @inject(AdminUserService) private readonly admin: AdminUserService,
    @inject(AdminService) private readonly overviewService: AdminService,
  ) {}

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
    const { id } = valid(res, 'params', uuidParamSchema);
    const { role } = valid(res, 'body', changeRoleSchema);
    res.json(await this.admin.changeRole(actorOf(req).id, id, role, req.ip ?? null));
  };

  /** POST /api/admin/roles */
  createRole = async (req: Request, res: Response) => {
    res.status(201).json({ role: await this.admin.createRole(actorOf(req).id, valid(res, 'body', createRoleSchema), req.ip ?? null) });
  };

  /** PUT /api/admin/roles/:key */
  updateRole = async (req: Request, res: Response) => {
    const { key } = valid(res, 'params', roleKeyParamSchema);
    res.json({ role: await this.admin.updateRole(actorOf(req).id, key, valid(res, 'body', updateRoleSchema), req.ip ?? null) });
  };

  /** DELETE /api/admin/roles/:key */
  deleteRole = async (req: Request, res: Response) => {
    const { key } = valid(res, 'params', roleKeyParamSchema);
    await this.admin.deleteRole(actorOf(req).id, key, req.ip ?? null);
    res.status(204).end();
  };

  /** GET /api/admin/overview */
  overview = async (_req: Request, res: Response) => {
    res.json({ overview: await this.overviewService.overview() });
  };

  /** GET /api/admin/jobs?status= */
  jobs = async (_req: Request, res: Response) => {
    const { status, periodic } = valid(res, 'query', adminJobsQuerySchema);
    res.json({ jobs: await this.overviewService.jobs(status, periodic ?? false) });
  };

  /** GET /api/admin/vps?query=&includeDeleted= */
  listVps = async (_req: Request, res: Response) => {
    const { query, includeDeleted } = valid(res, 'query', adminVpsQuerySchema);
    res.json({ vps: await this.overviewService.listVps(query, includeDeleted ?? false) });
  };
}
