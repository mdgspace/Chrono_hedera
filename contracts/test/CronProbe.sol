// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {HederaScheduleService} from "@hiero-ledger/hiero-contracts/schedule-service/HederaScheduleService.sol";
import {HederaResponseCodes} from "@hiero-ledger/hiero-contracts/common/HederaResponseCodes.sol";

/// @notice Harmless two-hop testnet canary for recursive HSS scheduleCall.
contract CronProbe is HederaScheduleService, Ownable {
    uint256 public constant HOP = 45 seconds;
    uint256 public constant HORIZON = 60 seconds;
    uint256 public constant GAS_LIMIT = 3_000_000;

    uint8 public nextGeneration = 1;
    address public firstSchedule;
    address public secondSchedule;
    uint256 public firstRequestedSecond;

    event ProbeScheduled(uint8 indexed generation, address scheduleAddress, uint256 requestedSecond);
    event ProbeExecuted(uint8 indexed generation, uint256 actualSecond);

    constructor() Ownable(msg.sender) {}
    receive() external payable {}

    function start() external onlyOwner {
        require(firstSchedule == address(0), "Probe already started");
        (firstSchedule, firstRequestedSecond) = _schedule(1);
    }

    function withdraw(address payable recipient) external onlyOwner {
        require(nextGeneration > 2 || (firstRequestedSecond != 0 && block.timestamp > firstRequestedSecond + 3 minutes), "Probe still pending");
        (bool sent,) = recipient.call{value: address(this).balance}("");
        require(sent, "HBAR transfer failed");
    }

    function tick(uint8 generation) external {
        require(msg.sender == address(this), "Only HSS self call");
        require(generation == nextGeneration, "Stale probe generation");
        nextGeneration++;
        emit ProbeExecuted(generation, block.timestamp);
        if (generation == 1) {
            (secondSchedule,) = _schedule(2);
        }
    }

    function _schedule(uint8 generation) internal returns (address scheduleAddress, uint256 requestedSecond) {
        for (uint256 offset = 0; offset <= HORIZON - HOP; offset++) {
            requestedSecond = block.timestamp + HOP + offset;
            if (!hasScheduleCapacity(requestedSecond, GAS_LIMIT)) continue;
            (int64 code, address created) = scheduleCall(
                address(this), requestedSecond, GAS_LIMIT, 0,
                abi.encodeCall(this.tick, (generation))
            );
            require(code == HederaResponseCodes.SUCCESS && created != address(0), "HSS creation failed");
            emit ProbeScheduled(generation, created, requestedSecond);
            return (created, requestedSecond);
        }
        revert("No probe capacity");
    }
}
