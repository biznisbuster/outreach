"use server";

import { revalidatePath } from "next/cache";
import { deleteAttachment } from "@/core/attachments";

export async function deleteAttachmentAction(formData: FormData) {
  const id = Number(formData.get("id"));
  await deleteAttachment(id);
  revalidatePath("/attachments");
}
