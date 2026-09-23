import type { Request, Response } from 'express';
import { inject, injectable } from 'tsyringe';
import { uuidParamSchema } from '../../shared/schemas/account.ts';
import { messagesQuerySchema, openConversationSchema, sendBodySchema } from '../../shared/schemas/support.ts';
import { valid } from '../http/middlewares/validate.ts';
import { SupportService } from '../services/SupportService.ts';

const currentUser = (req: Request) => req.user as NonNullable<Request['user']>;

/** Rotas do suporte (plano §15). Participação e estado são conferidos no SupportService. */
@injectable()
export class SupportController {
  constructor(@inject(SupportService) private readonly support: SupportService) {}

  /** POST /api/support/conversations */
  open = async (req: Request, res: Response) => {
    res
      .status(201)
      .json({ conversation: await this.support.open(currentUser(req), valid(res, 'body', openConversationSchema), req.ip ?? null) });
  };

  /** GET /api/support/conversations/current */
  current = async (req: Request, res: Response) => {
    res.json({ conversation: await this.support.current(currentUser(req)) });
  };

  /** GET /api/support/conversations/:id */
  get = async (req: Request, res: Response) => {
    res.json({ conversation: await this.support.get(currentUser(req), valid(res, 'params', uuidParamSchema).id) });
  };

  /** GET /api/support/conversations/:id/messages?after=&before= */
  messages = async (req: Request, res: Response) => {
    const { id } = valid(res, 'params', uuidParamSchema);
    res.json({ messages: await this.support.messages(currentUser(req), id, valid(res, 'query', messagesQuerySchema)) });
  };

  /** POST /api/support/conversations/:id/messages (alternativa ao socket, usada se o socket estiver fora). */
  send = async (req: Request, res: Response) => {
    const { id } = valid(res, 'params', uuidParamSchema);
    const { body } = valid(res, 'body', sendBodySchema);
    res.status(201).json({ message: await this.support.send(currentUser(req), id, body) });
  };

  /** POST /api/support/conversations/:id/close */
  close = async (req: Request, res: Response) => {
    const { id } = valid(res, 'params', uuidParamSchema);
    res.json({ conversation: await this.support.close(currentUser(req), id, req.ip ?? null) });
  };

  /** GET /api/support/queue */
  queue = async (_req: Request, res: Response) => {
    res.json({ waiting: await this.support.queue() });
  };

  /** GET /api/support/my-conversations */
  mine = async (req: Request, res: Response) => {
    res.json({ conversations: await this.support.myConversations(currentUser(req)) });
  };

  /** POST /api/support/conversations/:id/claim */
  claim = async (req: Request, res: Response) => {
    const { id } = valid(res, 'params', uuidParamSchema);
    res.json({ conversation: await this.support.claim(currentUser(req), id, req.ip ?? null) });
  };

  /** POST /api/support/conversations/:id/release */
  release = async (req: Request, res: Response) => {
    const { id } = valid(res, 'params', uuidParamSchema);
    res.json({ conversation: await this.support.release(currentUser(req), id, req.ip ?? null) });
  };
}
