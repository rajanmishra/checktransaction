const express = require('express');
const { Op } = require("sequelize");
const bodyParser = require('body-parser');
const { sequelize } = require('./model');
const { getProfile } = require('./middleware/getProfile');
const app = express();

app.use(bodyParser.json());
app.set('sequelize', sequelize);
app.set('models', sequelize.models);

// Function to handle database transactions
const handleTransaction = async (transactionFunction) => {
    try {
        await sequelize.transaction(transactionFunction);
    } catch (error) {
        console.error(error);
        throw new Error("Transaction failed");
    }
};

/**
 * @returns contract by id
 */
app.get('/contracts/:id', getProfile, async (req, res) => {
    const { Contract } = req.app.get('models');
    const { id } = req.params;
    const profileId = req.profile.id;

    const contract = await Contract.findOne({
        where: {
            id,
            [Op.or]: [
                { ContractorId: profileId },
                { ClientId: profileId }
            ]
        }
    });

    if (!contract) return res.status(404).end();
    res.json(contract);
});

/**
 * @returns all contracts
 */
app.get('/contracts', getProfile, async (req, res) => {
    const { Contract } = req.app.get('models');
    const profileId = req.profile.id;

    const contracts = await Contract.findAll({
        where: {
            [Op.or]: [
                { ContractorId: profileId },
                { ClientId: profileId }
            ],
            status: {
                [Op.not]: 'terminated'
            }
        }
    });

    if (!contracts) return res.status(404).end();
    res.json(contracts);
});

/**
 * @returns all unpaid jobs of a client or contractor
 */
app.get('/jobs/unpaid', getProfile, async (req, res) => {
    const { Job, Contract } = req.app.get('models');
    const profileId = req.profile.id;

    const jobs = await Job.findAll({
        include: [{
            model: Contract,
            where: {
                [Op.or]: [
                    { ContractorId: profileId },
                    { ClientId: profileId }
                ],
                status: 'in_progress'
            }
        }],
        where: {
            paid: {
                [Op.or]: [null, false]
            }
        }
    });

    if (!jobs) return res.status(404).end();
    res.json(jobs);
});

/**
 * @returns pay for a job
 */
app.post('/jobs/:job_id/pay', getProfile, async (req, res) => {
    const { Job, Contract, Profile } = req.app.get('models');
    const { job_id } = req.params;
    const profileId = req.profile.id;

    const job = await Job.findOne({
        where: { id: job_id },
        include: [{
            model: Contract,
            include: [{ model: Profile, as: 'Client' }]
        }]
    });

    if (!job || job.paid) return res.status(404).end();

    const jobAmount = job.price;
    const client = job.Contract.Client;

    if (client.balance < jobAmount) {
        return res.status(400).json({ message: "Not sufficient balance." });
    }

    await handleTransaction(async (t) => {
        await Profile.update(
            { balance: Profile.sequelize.literal(`balance - ${jobAmount}`) },
            { where: { id: client.id }, transaction: t }
        );

        await Profile.update(
            { balance: Profile.sequelize.literal(`balance + ${jobAmount}`) },
            { where: { id: job.Contract.ContractorId }, transaction: t }
        );

        await Job.update(
            { paid: true },
            { where: { id: job_id }, transaction: t }
        );
    });

    res.json({ message: "Successfully paid for the job" });
});

/**
 * @returns deposit money into a client's balance
 */
app.post('/balances/deposit/:userId', getProfile, async (req, res) => {
    const { Job, Contract, Profile } = req.app.get('models');
    const { userId } = req.params;
    const { amount } = req.body;

    if (!amount) {
        return res.status(400).json({ message: "Amount is missing." });
    }

    const totalUnpaidAmount = await Job.sum('price', {
        where: { paid: { [Op.or]: [null, false] } },
        include: [{
            model: Contract,
            where: { ClientId: userId }
        }]
    });

    if (amount > (totalUnpaidAmount / 4)) {
        return res.status(400).json({ message: "You can deposit only 25% of total unpaid amount." });
    }

    await Profile.update(
        { balance: Profile.sequelize.literal(`balance + ${amount}`) },
        { where: { id: userId } }
    );

    res.json({ message: "Balance added successfully." });
});

/**
 * @returns the best profession based on earnings
 */
app.get('/admin/best-profession', getProfile, async (req, res) => {
    const { Job, Contract, Profile } = req.app.get('models');
    const { start, end } = req.query;

    const bestProfession = await Job.findOne({
        attributes: [[sequelize.fn('sum', sequelize.col('price')), 'totalEarnings']],
        where: {
            paid: true,
            createdAt: { [Op.between]: [start, end] }
        },
        include: [{
            model: Contract,
            include: [{ model: Profile, as: 'Contractor', attributes: ['profession'] }]
        }],
        group: ['Contract->Contractor.profession'],
        order: [[sequelize.literal('totalEarnings'), 'DESC']],
        limit: 1
    });

    if (!bestProfession) return res.status(404).end();
    res.json(bestProfession.Contract.Contractor.profession);
});

/**
 * @returns the best clients based on payments
 */
app.get('/admin/best-clients', getProfile, async (req, res) => {
    const { Job, Contract, Profile } = req.app.get('models');
    const { start, end, limit = 2 } = req.query;

    const bestClients = await Job.findAll({
        attributes: [
            'Contract.Client.id',
            [sequelize.literal("Contract.Client.firstName || ' ' || Contract.Client.lastName"), 'fullName'],
            [sequelize.fn('sum', sequelize.col('price')), 'totalPaid']
        ],
        where: {
            paid: true,
            createdAt: { [Op.between]: [start, end] }
        },
        include: [{
            model: Contract,
            include: [{ model: Profile, as: 'Client', attributes: [] }]
        }],
        group: ['Contract.Client.id'],
        order: [[sequelize.literal('totalPaid'), 'DESC']],
        limit: parseInt(limit),
        raw: true
    });

    if (!bestClients) return res.status(404).end();
    res.json(bestClients);
});

module.exports = app;
