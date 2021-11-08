const express = require('express');
const { Op } = require("sequelize");
const bodyParser = require('body-parser');
const {sequelize} = require('./model')
const {getProfile} = require('./middleware/getProfile')
const app = express();
app.use(bodyParser.json());
app.set('sequelize', sequelize)
app.set('models', sequelize.models)

/**
 * FIX ME!
 * @returns contract by id
 */
app.get('/contracts/:id', getProfile ,async (req, res) =>{
    const {Contract} = req.app.get('models')
    const {id} = req.params
    /* Not validating profileid it will already validated at the middleware layer */
    const ContractorId =  req.get('profile_id');
    const contract = await Contract.findOne({where: {id, ContractorId}});
    if(!contract) return res.status(404).end()
    res.json(contract)
})

/**
 * @returns all contract
 */
 app.get('/contracts', getProfile ,async (req, res) =>{
    const {Contract} = req.app.get('models')
    /* Not validating profileid it will already validated at the middleware layer */
    const userId =  req.get('profile_id');
    const contract = await Contract.findAll({
        where: {
            [Op.or]: [
                { ContractorId: userId },
                { ClientId: userId }
            ],
            status: [
                "in_progress",
                "new" 
            ]
        }
    });
    if(!contract) return res.status(404).end()
    res.json(contract)
})

/**
 * @returns all unpaid job of a client or contractor
 */
 app.get('/jobs/unpaid', getProfile ,async (req, res) =>{
    const {Job, Contract} = req.app.get('models')
    /* Not validating profileid it will already validated at the middleware layer */
    const userId =  req.get('profile_id');
    const contract = await Job.findAll({
        include: [{
            model: Contract,
            where: { 
                [Op.or]: [
                { ContractorId: userId },
                { ClientId: userId }
            ],
            status: "in_progress"
            }
        }]
    });
    if(!contract) return res.status(404).end()
    res.json(contract)
})

/**
 * @returns Pay for a job
 */
 app.post('/jobs/:job_id/pay', getProfile ,async (req, res) =>{
    const {Job, Contract, Profile} = req.app.get('models')
    const id =  req.params.job_id;
    if(!id) {
        return res.status(400).json({"message":"Job Id is missing."})
    }
    const jobData = await Job.findOne({
        //to include just incompleted jobs
            where: {
                 id,
                 [Op.or]: [
                    { paid: null },
                    { paid: false }
                    ]
                },
            required: true,    
            include: [{
                model: Contract,
                required: true,
                include: [{
                    model: Profile,
                    as: 'Client',
                    required: true,
                }] 
            }]
    });
    if(!jobData) return res.status(404).end()
    const amount = parseInt(jobData.price)
    if(jobData.Contract && jobData.Contract.Client && (parseInt(jobData.Contract.Client.balance) > amount ) ){
        await sequelize.transaction( async (t) => {
            try{
                await Profile.update({
                    balance: Profile.sequelize.literal('balance - ' + amount)
                 }, {
                      where: {
                      id: jobData.Contract.ClientId
                    }
                 }, { transaction: t })
               await Profile.update({
                balance: Profile.sequelize.literal('balance + ' + amount)
             }, {
                  where: {
                    id: jobData.Contract.ContractorId
                }
             }, { transaction: t})
             return res.json({"message":"Successfully paid for the job"})
            }
            catch(e){
                console.log(e)
                return res.status(400).json({"message":"Something went wrong."})
            }
        })
    }else{
        return res.status(400).json({"message":"Not sufficient balance."})
    }

})

/**
 * @returns to deposit money
 */
 app.post('/balances/deposit/:userId', getProfile ,async (req, res) =>{
    const {Job, Contract, Profile} = req.app.get('models')
    const ClientId =  req.params.userId;
    if(!ClientId) {
        return res.status(400).json({"message":"User Id is missing."})
    }
    if(!req.body.amount) {
        return res.status(400).json({"message":"Amount key is missing."})
    }
    const amountSum = await Job.findOne({
        attributes: [ [Job.sequelize.fn('sum', Job.sequelize.col('price')), 'total_to_pay']],
        required: true,
        //to include just incompleted jobs
        where: { 
            [Op.or]: [
            { paid: null },
            { paid: false }
            ]
        },
        include: [{
            model: Contract,
            required: true,
            attributes: [],
            where:{ClientId}
        }],
        group: ['Contract.ClientId'],
        raw: true,
    });
    if(!amountSum) return res.status(404).end()
    const amount = parseInt(req.body.amount)
    if(amount > ((parseInt(amountSum.total_to_pay))/4 ) ){
        return res.status(400).json({"message":"You can deposit only 25% of total pending amount."})
    }else{
       const result = await Profile.update({
            balance: Profile.sequelize.literal('balance + ' + amount)
         }, {
              where: {
              id: ClientId
            }
         })
         if(result){
            res.json({"message":"Balance added successfully."})
         }else{
            res.status(400).json({"message":"Something went wrong."})
         }
    }
})


/**
 * @returns all unpaid job of a client or contractor
 */
 app.get('/admin/best-profession', getProfile ,async (req, res) =>{
    const {Job, Contract, Profile} = req.app.get('models')
    /* Not validating profileid it will already validated at the middleware layer */
    const startDate =  req.query.start;
    const endDate =  req.query.end;
    let where = {}
     //to include just paid/completed jobs
    where.paid = true;
    if (startDate && endDate){
        where.createdAt =  { [Op.gte] : startDate, [Op.lte] : endDate};
    }
    const priceSum = await Job.findAll({
        attributes: [ [Job.sequelize.fn('sum', Job.sequelize.col('price')), 'total_earning']],
        required: true,
        where: where,
        include: [{
            model: Contract,
            required: true,
            include: [{
                model: Profile,
                attributes: ['profession'],
                as: 'Contractor',
                required: true
            }] 
        }],
        group: ['Contract->Contractor.id'],
        order : [[Job.sequelize.fn('sum', Job.sequelize.col('price')), 'DESC']],
        offset:0,
        limit : 1,
        subQuery:false
    });
    if(!priceSum || !priceSum[0]) return res.status(404).end()
    res.json(priceSum[0].Contract.Contractor.profession)
})
/**
 * @returns all unpaid job of a client or contractor
 */
 app.get('/admin/best-clients', getProfile ,async (req, res) =>{
    const {Job, Contract, Profile} = req.app.get('models')
    /* Not validating profileid it will already validated at the middleware layer */
    const startDate =  req.query.start;
    const endDate =  req.query.end;
    const limit =  req.query.limit || 2;
    let where = {}
     //to include just paid/completed jobs
    where.paid = true;
    if (startDate && endDate){
        where.createdAt =  { [Op.gte] : startDate, [Op.lte] : endDate};
    }
    const amountSum = await Job.findAll({
        attributes: ['id', [Job.sequelize.literal("firstName || ' ' || lastName"), 'fullName'], ['Price', 'Paid']],
        required: true,
        where: where,
        include: [{
            model: Contract,
            attributes: [],
            required: true,
            include: [{
                model: Profile,
                as: 'Client',
                attributes: [],
                required: true,
            }] 
        }],
        group: ['Contract->Client.id'],
        order : [[Job.sequelize.col('price'), 'DESC']],
        offset:0,
        limit : limit,
        subQuery:false,
        raw: true
    });
    if(!amountSum) return res.status(404).end()
    res.json(amountSum)
})

module.exports = app;
