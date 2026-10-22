"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Checkbox } from "@base-ui/react/checkbox";
import { NumberField } from "@base-ui/react/number-field";
import { Popover } from "@base-ui/react/popover";
import { Select } from "@base-ui/react/select";
import { Switch } from "@base-ui/react/switch";
import { DayPicker } from "react-day-picker";
import { CalendarBlankIcon } from "@phosphor-icons/react/dist/csr/CalendarBlank";
import { CaretDownIcon } from "@phosphor-icons/react/dist/csr/CaretDown";
import { CaretLeftIcon } from "@phosphor-icons/react/dist/csr/CaretLeft";
import { CaretRightIcon } from "@phosphor-icons/react/dist/csr/CaretRight";
import { CheckIcon } from "@phosphor-icons/react/dist/csr/Check";
import { MinusIcon } from "@phosphor-icons/react/dist/csr/Minus";
import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import { useIsPhone } from "../media";
import { Sheet } from "./sheet";
import {
  formatLocalDateTime,
  joinLocalDateTime,
  splitLocalDateTime,
  timeSlots,
} from "../datetime";

interface ControlProps {
  /** The control's id; the surrounding Field's label points at it. */
  id: string;
  disabled?: boolean;
  "aria-describedby"?: string;
}

/**
 * A date and time on the session's own wall clock, stored as the same
 * "YYYY-MM-DDTHH:mm" string a datetime-local input produces. The trigger reads
 * like a sentence. On larger screens a popover pairs a month calendar with
 * 15-minute slots; on a phone the same panel opens as a bottom sheet, where
 * there is room for it above the keyboard-free half of the screen.
 */
export function DateTimeField({
  id,
  value,
  onChange,
  disabled,
  title = "Choose date and time",
  placeholder = "Pick a date and time",
  defaultTime = "18:00",
  "aria-describedby": describedBy,
}: ControlProps & {
  value: string;
  onChange: (value: string) => void;
  /** The sheet heading on phones; use the field's label. */
  title?: string;
  placeholder?: string;
  /** Used when a date is picked before any time. */
  defaultTime?: string;
}) {
  const [open, setOpen] = useState(false);
  const phone = useIsPhone();
  const button = useRef<HTMLButtonElement>(null);
  // Safari doesn't focus a tapped button, so the dialog can't hand focus back
  // on its own; return it to the trigger explicitly.
  const close = () => {
    setOpen(false);
    button.current?.focus();
  };
  const label = formatLocalDateTime(value);
  const trigger = {
    id,
    className: "rp-control rp-picker-trigger",
    disabled,
    // The field's label plus the chosen value, so "Starts, Thu, Nov 5 ·
    // 7:00 PM" is announced rather than the label alone.
    "aria-labelledby": `${id}-label ${id}-value`,
    "aria-describedby": describedBy,
    children: (
      <>
        <CalendarBlankIcon size={20} aria-hidden="true" />
        <span
          id={`${id}-value`}
          className={label ? "rp-nums" : "rp-placeholder"}
        >
          {label ?? placeholder}
        </span>
        <CaretDownIcon
          className="rp-picker-caret"
          size={16}
          aria-hidden="true"
        />
      </>
    ),
  };
  const panel = (done: ReactNode) => (
    <DateTimePanel
      value={value}
      onChange={onChange}
      defaultTime={defaultTime}
      done={done}
    />
  );
  if (phone)
    return (
      <>
        <button
          ref={button}
          type="button"
          aria-haspopup="dialog"
          data-popup-open={open || undefined}
          onClick={() => setOpen(true)}
          {...trigger}
        />
        <Sheet open={open} onClose={close} title={title}>
          {panel(
            <button
              type="button"
              className="rp-button rp-button--primary rp-button--sm"
              onClick={close}
            >
              Done
            </button>,
          )}
        </Sheet>
      </>
    );
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger {...trigger} />
      <Popover.Portal>
        <Popover.Positioner
          className="rp-positioner"
          sideOffset={8}
          align="start"
          collisionPadding={12}
        >
          <Popover.Popup className="rp-popover rp-datetime">
            <Popover.Title className="rp-sr-only">{title}</Popover.Title>
            {panel(
              <Popover.Close className="rp-button rp-button--primary rp-button--sm">
                Done
              </Popover.Close>,
            )}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

function DateTimePanel({
  value,
  onChange,
  defaultTime,
  done,
}: {
  value: string;
  onChange: (value: string) => void;
  defaultTime: string;
  done: ReactNode;
}) {
  const { date, time } = splitLocalDateTime(value);
  return (
    <>
      <div className="rp-datetime__body">
        <DayPicker
          className="rp-calendar"
          mode="single"
          selected={date ?? undefined}
          defaultMonth={date ?? undefined}
          showOutsideDays
          onSelect={(day) => {
            if (day) onChange(joinLocalDateTime(day, time ?? defaultTime));
          }}
          components={{
            Chevron: ({ orientation }) =>
              orientation === "left" ? (
                <CaretLeftIcon size={18} aria-hidden="true" />
              ) : (
                <CaretRightIcon size={18} aria-hidden="true" />
              ),
          }}
        />
        <TimeSlots
          value={time}
          disabled={!date}
          onPick={(slot) => date && onChange(joinLocalDateTime(date, slot))}
        />
      </div>
      <div className="rp-popover__footer">
        {value ? (
          <button
            type="button"
            className="rp-button rp-button--link"
            onClick={() => onChange("")}
          >
            Clear
          </button>
        ) : (
          <span />
        )}
        {done}
      </div>
    </>
  );
}

function TimeSlots({
  value,
  disabled,
  onPick,
}: {
  value: string | null;
  disabled: boolean;
  onPick: (slot: string) => void;
}) {
  const list = useRef<HTMLDivElement>(null);
  const slots = useMemo(() => {
    const all = timeSlots(15);
    // An existing off-grid time (say 19:10) stays choosable.
    return value && !all.some((slot) => slot.value === value)
      ? [...all, ...timeSlots(0, [value])].sort((a, b) =>
          a.value.localeCompare(b.value),
        )
      : all;
  }, [value]);
  useEffect(() => {
    list.current
      ?.querySelector<HTMLElement>('[aria-pressed="true"], [data-anchor]')
      ?.scrollIntoView({ block: "center", inline: "center" });
  }, []);
  return (
    <div
      ref={list}
      className="rp-timeslots"
      role="group"
      aria-label={disabled ? "Time (pick a date first)" : "Time"}
    >
      {slots.map((slot) => (
        <button
          key={slot.value}
          type="button"
          className="rp-timeslot rp-nums"
          aria-pressed={slot.value === value}
          data-anchor={slot.value === "18:00" || undefined}
          disabled={disabled}
          onClick={() => onPick(slot.value)}
        >
          {slot.label}
        </button>
      ))}
    </div>
  );
}

export interface Option {
  value: string;
  label: string;
}

/** A short list of fixed choices, styled like the other controls. */
export function SelectField({
  id,
  value,
  onChange,
  options,
  disabled,
  "aria-describedby": describedBy,
}: ControlProps & {
  value: string;
  onChange: (value: string) => void;
  options: Option[];
}) {
  return (
    <Select.Root
      items={options}
      value={value}
      onValueChange={(next) => next !== null && onChange(String(next))}
      disabled={disabled}
    >
      <Select.Trigger
        id={id}
        className="rp-control rp-picker-trigger"
        aria-describedby={describedBy}
      >
        <Select.Value className="rp-select-value" />
        <Select.Icon className="rp-picker-caret">
          <CaretDownIcon size={16} aria-hidden="true" />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Positioner
          className="rp-positioner"
          sideOffset={8}
          alignItemWithTrigger={false}
          collisionPadding={12}
        >
          <Select.Popup className="rp-popover rp-listbox">
            <Select.List>
              {options.map((option) => (
                <Select.Item
                  key={option.value}
                  value={option.value}
                  className="rp-option"
                >
                  <Select.ItemText>{option.label}</Select.ItemText>
                  <Select.ItemIndicator className="rp-option__check">
                    <CheckIcon size={16} aria-hidden="true" />
                  </Select.ItemIndicator>
                </Select.Item>
              ))}
            </Select.List>
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  );
}

/**
 * A whole number with − and + buttons. The form keeps text, so the value goes
 * in and out as a string; an empty field stays empty rather than becoming 0.
 */
export function NumberStepper({
  id,
  value,
  onChange,
  min,
  max,
  disabled,
  "aria-describedby": describedBy,
}: ControlProps & {
  value: string;
  onChange: (value: string) => void;
  min?: number;
  max?: number;
}) {
  const parsed = value.trim() === "" ? null : Number(value);
  return (
    <NumberField.Root
      value={Number.isFinite(parsed) ? parsed : null}
      onValueChange={(next) => onChange(next === null ? "" : String(next))}
      min={min}
      max={max}
      step={1}
      disabled={disabled}
    >
      <NumberField.Group className="rp-control rp-stepper">
        <NumberField.Decrement
          className="rp-stepper__button"
          aria-label="Decrease"
        >
          <MinusIcon size={18} aria-hidden="true" />
        </NumberField.Decrement>
        <NumberField.Input
          id={id}
          className="rp-bare rp-stepper__input rp-nums"
          aria-describedby={describedBy}
        />
        <NumberField.Increment
          className="rp-stepper__button"
          aria-label="Increase"
        >
          <PlusIcon size={18} aria-hidden="true" />
        </NumberField.Increment>
      </NumberField.Group>
    </NumberField.Root>
  );
}

/** A text input with a fixed prefix (a currency code) inside the same box. */
export function AffixInput({
  prefix,
  className,
  ...props
}: { prefix: ReactNode } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="rp-control rp-affix">
      <span className="rp-affix__text" aria-hidden="true">
        {prefix}
      </span>
      <input
        className={`rp-bare rp-affix__input ${className ?? ""}`}
        {...props}
      />
    </div>
  );
}

/** An on/off setting with its label and an optional line of detail. */
export function SwitchField({
  checked,
  onCheckedChange,
  disabled,
  children,
  description,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  children: ReactNode;
  description?: ReactNode;
}) {
  return (
    <label className="rp-toggle-row">
      <span className="rp-toggle-row__text">
        <span className="rp-toggle-row__label">{children}</span>
        {description ? (
          <span className="rp-toggle-row__description">{description}</span>
        ) : null}
      </span>
      <Switch.Root
        className="rp-switch"
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
      >
        <Switch.Thumb className="rp-switch__thumb" />
      </Switch.Root>
    </label>
  );
}

/** A checkbox with its label beside it; the whole row is the target. */
export function CheckField({
  checked,
  onCheckedChange,
  disabled,
  children,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <label className="rp-check">
      <Checkbox.Root
        className="rp-checkbox"
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
      >
        <Checkbox.Indicator className="rp-checkbox__indicator">
          <CheckIcon size={16} weight="bold" aria-hidden="true" />
        </Checkbox.Indicator>
      </Checkbox.Root>
      <span>{children}</span>
    </label>
  );
}
