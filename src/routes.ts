import { FastifyInstance } from "fastify"
import { prisma } from "./lib/prisma"
import { z } from 'zod'
import dayjs from 'dayjs'

export async function appRoutes(app: FastifyInstance) {
    app.get('/habits', async () => {
        const habits = await prisma.habit.findMany()
        return habits
    })

    app.post('/habits', async (request) => {
        const createHabitBody = z.object({
            title: z.string(),
            weekDays: z.array(
                z.number().min(0).max(6)
            )
        })

        const { title, weekDays } = createHabitBody.parse(request.body)

        const today = dayjs().startOf('day').toDate()

        await prisma.habit.create({
            data: {
                title,
                created_at: new Date(),
                weekDays: {
                    create: weekDays.map(weekDay => {
                        return {
                            week_day: weekDay,
                        }
                    })
                }
            }
        })
    })

    app.get('/day', async (request) => {
        const getDayParams = z.object({
            date: z.coerce.date()
        })

        const { date } = getDayParams.parse(request.query)
        const ParsedDate = dayjs(date).startOf('day')
        const weekDay = ParsedDate.get('day')

        const possibleHabits = await prisma.habit.findMany({
            where: {
                created_at: {
                    lte: date,
                },
                weekDays: {
                    some: {
                        week_day: weekDay
                    }
                }
            }
        })

        const day = await prisma.day.findUnique({
            where: {
                date: ParsedDate.toDate()
            },
            include: {
                dayHabits: true,
            }
        })

        const completedHabits = day?.dayHabits.map(dayHabit => {
            return dayHabit.habit_id
        })

        return {
            possibleHabits,
            completedHabits
        }
    })

    //completar ou não completar hábitos
    app.patch('/habits/:id/toggle', async (request) => {
        const toggleHabitParamns = z.object({
            id: z.string().uuid(),
        })

        const { id } = toggleHabitParamns.parse(request.params)

        const today = dayjs().startOf('day').toDate()

        let day = await prisma.day.findUnique({
            where: {
                date: today,
            }
        })

        if (!day) {
            day = await prisma.day.create({
                data: {
                    date: today,
                }
            })
        }

        //Verifica se já foi marcado o hábito
        const dayHabit = await prisma.dayHabit.findUnique({
            where: {
                day_id_habit_id: {
                    day_id: day.id,
                    habit_id: id,
                }
            }
        })

        if (dayHabit) { 
            await prisma.dayHabit.delete({
                where:{
                    id: dayHabit.id,
                }
            })
        }
        else {
            //Completar o Hábito
            await prisma.dayHabit.create({
                data: {
                    day_id: day.id,
                    habit_id: id,
                }
            })
        }



    })

    app.get('/summary', async () => {
        //query mais complexa, mais condições, relacionamentos => sql na mão (RAW)
        //Pris ORM: RAW SQL => SqlLite

        const summary = await prisma.$queryRaw`
            Select 
                D.id,
                D.date,
                (
                    select 
                        cast(count(*) as float)
                    from day_habits dh 
                    where dh.day_id = D.id 
                ) as completed,
                (
                    select 
                        cast(count(*) as float)
                    from habit_week_days hwd
                    join habits h 
                        on h.id = hwd.habit_id
                    where 
                        hwd.week_day = cast(strftime('%w', D.date/1000.0, 'unixepoch') as int )
                        and h.created_at <= d.date
                ) as amount
            from days D
            order by D.date
        `

        return summary
    })
}