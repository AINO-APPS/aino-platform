import API, { type AnyData, type Params } from "./client";

// Compensation Templates
export const getCompensationTemplates = () => API.get("/compensation/templates");
export const createCompensationTemplate = (data: AnyData) =>
    API.post("/compensation/templates", data);
export const updateCompensationTemplate = (id: number | string, data: AnyData) =>
    API.put(`/compensation/templates/${id}`, data);
export const deleteCompensationTemplate = (id: number | string) =>
    API.delete(`/compensation/templates/${id}`);

// Employee Compensation
export const getEmployeeCompensations = () => API.get("/compensation/employees");
export const getEmployeeCompensation = (userId: number | string) =>
    API.get(`/compensation/employees/${userId}`);
export const assignCompensation = (userId: number | string, data: AnyData) =>
    API.post(`/compensation/employees/${userId}`, data);
export const updateCompensation = (
    userId: number | string,
    id: number | string,
    data: AnyData
) => API.put(`/compensation/employees/${userId}/${id}`, data);

// Salary Slips (HR Admin)
export const runPayroll = (data: AnyData) => API.post("/compensation/payroll-run", data);
export const getSalarySlips = (params?: Params) =>
    API.get("/compensation/salary-slips", { params });
export const getSalarySlip = (id: number | string) =>
    API.get(`/compensation/salary-slips/${id}`);
export const publishSalarySlip = (id: number | string) =>
    API.put(`/compensation/salary-slips/${id}/publish`);
export const bulkPublishSlips = (data: AnyData) =>
    API.post("/compensation/salary-slips/bulk-publish", data);
export const downloadSalarySlipPdf = (id: number | string) =>
    API.get(`/compensation/salary-slips/${id}/pdf`, { responseType: "blob" });

// Salary Slips (Employee Self-Service)
export const getMySalarySlips = () => API.get("/compensation/my-slips");
export const downloadMySalarySlipPdf = (id: number | string) =>
    API.get(`/compensation/my-slips/${id}/pdf`, { responseType: "blob" });

// Disbursement
export const disburseSalaries = (data: AnyData) => API.post("/compensation/disburse", data);
export const disburseSingle = (slipId: number | string) =>
    API.post(`/compensation/disburse/${slipId}`);
export const getDisbursements = (params?: Params) =>
    API.get("/compensation/disbursements", { params });
export const retryDisbursement = (id: number | string) =>
    API.post(`/compensation/disburse/retry/${id}`);

// Payment Config
export const getPaymentConfig = () => API.get("/compensation/payment-config");
export const savePaymentConfig = (data: AnyData) =>
    API.put("/compensation/payment-config", data);
export const testPaymentConfig = () => API.post("/compensation/payment-config/test");

// Employee Bank Details
export const getOrgBankDetails = () => API.get("/compensation/bank-details");
export const getEmployeeBankDetails = (userId: number | string) =>
    API.get(`/compensation/bank-details/${userId}`);
export const saveEmployeeBankDetails = (userId: number | string, data: AnyData) =>
    API.post(`/compensation/bank-details/${userId}`, data);
export const verifyBankDetails = (userId: number | string) =>
    API.post(`/compensation/bank-details/${userId}/verify`);
export const getMyBankDetails = () => API.get("/compensation/my-bank-details");
export const saveMyBankDetails = (data: AnyData) =>
    API.post("/compensation/my-bank-details", data);
export const getBankVerifications = () => API.get("/compensation/bank-verifications");
export const approveBankDetails = (userId: number | string) =>
    API.post(`/compensation/bank-details/${userId}/approve`);
export const rejectBankDetails = (userId: number | string) =>
    API.post(`/compensation/bank-details/${userId}/reject`);

// CTC Config
export const getCtcConfig = () => API.get("/compensation/ctc-config");
export const saveCtcConfig = (data: AnyData) => API.put("/compensation/ctc-config", data);

// Bulk User Import
export const importUsers = (payload: AnyData, isFile = false) => {
    if (isFile) {
        return API.post("/admin/users/import", payload, {
            headers: { "Content-Type": "multipart/form-data" },
        });
    }
    return API.post("/admin/users/import", payload);
};
