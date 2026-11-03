import express from 'express';
import type { Request, Response } from 'express';
import { taskActorFromRequest } from '../../modules/tasks/tasks.policy';
import { setEstimates, InvalidEstimate } from '../../modules/tasks/tasks.estimates';
const auth = require('../../middleware/auth');
const { loadUserContext } = require('../../middleware/rbac');
const router = express.Router();
router.patch('/:id/estimates', auth, loadUserContext, async (req:Request,res:Response) => {
    try {
        const result = await setEstimates({query:req.db!.query,transaction:req.db!.transaction!},Number(req.params.id),taskActorFromRequest(req),req.body,{
            tenantId:req.tenantId == null ? null : Number(req.tenantId), ip:req.ip, userAgent:req.get('user-agent'),
        });
        if ('conflict' in result && result.conflict) return res.status(result.conflict.status).json(result.conflict.body);
        return res.json(result);
    } catch (err) {
        if (err instanceof InvalidEstimate) return res.status(400).json({code:err.code,error:err.message});
        req.log.error({err},'Error setting estimates');
        return res.status(500).json({error:'Failed to set estimates'});
    }
});
export = router;
