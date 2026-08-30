"use client";

import { formatSwedishPhone } from "@/lib/validation/swedish";
import type { SelectedChannels } from "@/lib/sms/channels";

export function DeliveryChannelPicker({
  email,
  phone,
  selected,
  onChange,
  disabled,
}: {
  email?: string | null;
  phone?: string | null;
  selected: SelectedChannels;
  onChange: (next: SelectedChannels) => void;
  disabled?: boolean;
}) {
  const emailValue = email?.trim() || "";
  const phoneValue = phone?.trim() || "";
  const showEmail = Boolean(emailValue);
  const showSms = Boolean(phoneValue);

  return (
    <div className="space-y-3">
      {showEmail ? (
        <label className="flex items-start gap-3 text-[14px]">
          <input
            type="checkbox"
            className="mt-1"
            checked={selected.email}
            disabled={disabled}
            onChange={(e) => onChange({ ...selected, email: e.target.checked })}
          />
          <span>
            <span className="font-medium text-ink">E-post</span>
            <span className="mt-0.5 block text-soft">{emailValue}</span>
          </span>
        </label>
      ) : null}
      {showSms ? (
        <label className="flex items-start gap-3 text-[14px]">
          <input
            type="checkbox"
            className="mt-1"
            checked={selected.sms}
            disabled={disabled}
            onChange={(e) => onChange({ ...selected, sms: e.target.checked })}
          />
          <span>
            <span className="font-medium text-ink">SMS</span>
            <span className="mt-0.5 block text-soft">{formatSwedishPhone(phoneValue)}</span>
          </span>
        </label>
      ) : null}
    </div>
  );
}
