import type { CustomerRecord, PosDatabase } from '../types'

export interface CustomerWriteData {
  firstName: string
  lastName: string
  companyName: string
  address: string
  phoneNumber: string
  email: string
  imageDataUrl: string | null
}

const customerColumns = `id, first_name, last_name, company_name, address,
  phone_number, email, image_data_url, created_at, updated_at`

export function createCustomerRepository(database: PosDatabase) {
  const listStatement = database.prepare(
    `SELECT ${customerColumns}
     FROM customers
     ORDER BY company_name COLLATE NOCASE, last_name COLLATE NOCASE,
              first_name COLLATE NOCASE, id`
  )
  const getByIdStatement = database.prepare(`SELECT ${customerColumns} FROM customers WHERE id = ?`)
  const insertStatement = database.prepare(
    `INSERT INTO customers
       (first_name, last_name, company_name, address, phone_number, email, image_data_url)
     VALUES
       (@firstName, @lastName, @companyName, @address, @phoneNumber, @email, @imageDataUrl)`
  )
  const updateStatement = database.prepare(
    `UPDATE customers
     SET first_name = @firstName,
         last_name = @lastName,
         company_name = @companyName,
         address = @address,
         phone_number = @phoneNumber,
         email = @email,
         image_data_url = @imageDataUrl,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = @id`
  )

  function getById(id: number): CustomerRecord | undefined {
    return getByIdStatement.get(id) as CustomerRecord | undefined
  }

  return {
    list(): CustomerRecord[] {
      return listStatement.all() as CustomerRecord[]
    },
    getById,
    create(customer: CustomerWriteData): CustomerRecord | undefined {
      const result = insertStatement.run(customer)
      return getById(Number(result.lastInsertRowid))
    },
    update(id: number, customer: CustomerWriteData): CustomerRecord | undefined {
      updateStatement.run({ ...customer, id })
      return getById(id)
    }
  }
}

export type CustomerRepository = ReturnType<typeof createCustomerRepository>
