import { masterQuery } from "../../db";
import { createClientVersionRepository } from "./clientVersions.repository";
import { createClientVersionService } from "./clientVersions.service";

export const clientVersions = createClientVersionService(createClientVersionRepository(masterQuery));
